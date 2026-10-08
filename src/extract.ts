// Extracts schema.org data from JSON-LD, microdata, and RDFa into one node model.
import { parseDocument } from "htmlparser2";

import type { Extraction, MarkupFormat, SdNode, SdValue, SyntaxIssue } from "./types";
import { isSchemaOrgIri, localName } from "./vocab";

// Minimal DOM shapes from htmlparser2/domhandler, so callers don't need its types.
interface DomText { type: "text"; data: string }
interface DomElement {
  type: "tag" | "script" | "style";
  name: string;
  attribs: Record<string, string>;
  children: DomNode[];
  startIndex: number | null;
}
type DomNode = DomElement | DomText | { type: string; children?: DomNode[] };

const isElement = (node: DomNode): node is DomElement => node.type === "tag" || node.type === "script" || node.type === "style";
const hasAttr = (element: DomElement, name: string) => Object.prototype.hasOwnProperty.call(element.attribs, name);

function textContent(node: DomNode): string {
  if (node.type === "text") return (node as DomText).data;
  const children = (node as { children?: DomNode[] }).children ?? [];
  return children.map(textContent).join("");
}

const collapse = (value: string) => value.replace(/\s+/g, " ").trim();

function emptyCounts(): Record<MarkupFormat, number> {
  return { "json-ld": 0, microdata: 0, rdfa: 0 };
}

// ---------------------------------------------------------------------------------------------
// JSON-LD

function lineAndColumn(text: string, position: number): { line: number; column: number } {
  const before = text.slice(0, position);
  const lines = before.split("\n");
  return { line: lines.length, column: lines[lines.length - 1].length + 1 };
}

function parseErrorLocation(error: unknown, text: string): { message: string; line?: number; column?: number } {
  const message = error instanceof Error ? error.message : String(error);
  const lineMatch = message.match(/line (\d+) column (\d+)/);
  if (lineMatch) return { message, line: Number(lineMatch[1]), column: Number(lineMatch[2]) };
  const positionMatch = message.match(/position (\d+)/);
  if (positionMatch) return { message, ...lineAndColumn(text, Number(positionMatch[1])) };
  return { message };
}

/**
 * JSON.parse keeps only the last value when a key repeats, so duplicates disappear silently.
 * This scans already-valid JSON and reports each repeated key with its line.
 */
function findDuplicateKeys(text: string): Array<{ key: string; line: number }> {
  const duplicates: Array<{ key: string; line: number }> = [];
  const stack: Array<Set<string> | null> = [];
  let index = 0;
  let line = 1;
  let expectingKey = false;
  while (index < text.length) {
    const char = text[index];
    if (char === "\n") line += 1;
    if (char === "{") { stack.push(new Set()); expectingKey = true; index += 1; continue; }
    if (char === "[") { stack.push(null); expectingKey = false; index += 1; continue; }
    if (char === "}" || char === "]") { stack.pop(); expectingKey = false; index += 1; continue; }
    if (char === ",") { expectingKey = stack[stack.length - 1] instanceof Set; index += 1; continue; }
    if (char === "\"") {
      let end = index + 1;
      while (end < text.length && text[end] !== "\"") end += text[end] === "\\" ? 2 : 1;
      const literal = text.slice(index, end + 1);
      const keys = stack[stack.length - 1];
      if (expectingKey && keys instanceof Set) {
        const key = JSON.parse(literal) as string;
        if (keys.has(key)) duplicates.push({ key, line });
        keys.add(key);
        expectingKey = false;
      }
      line += (literal.match(/\n/g) ?? []).length;
      index = end + 1;
      continue;
    }
    index += 1;
  }
  return duplicates;
}

function contextIsSchemaOrg(context: unknown): boolean {
  if (typeof context === "string") return /schema\.org/i.test(context);
  if (Array.isArray(context)) return context.some(contextIsSchemaOrg);
  if (context && typeof context === "object") {
    const vocab = (context as Record<string, unknown>)["@vocab"];
    return typeof vocab === "string" && /schema\.org/i.test(vocab);
  }
  return false;
}

/** schema.org terms become local names; terms from other vocabularies keep their prefix or IRI. */
function normalizeTerm(term: string): string {
  if (isSchemaOrgIri(term)) return localName(term);
  if (term.includes(":") || term.includes("/")) return term;
  return term;
}

function jsonPathFor(base: string, key: string | number): string {
  if (typeof key === "number") return `${base}[${key}]`;
  return /^[A-Za-z_$][\w$]*$/.test(key) ? `${base}.${key}` : `${base}[${JSON.stringify(key)}]`;
}

function jsonLdNode(value: Record<string, unknown>, schemaOrg: boolean, path: string, label: string): SdNode {
  const node: SdNode = {
    types: [],
    properties: [],
    format: "json-ld",
    path: `${label} › ${path}`,
    schemaOrg,
  };
  const rawTypes = value["@type"];
  for (const type of Array.isArray(rawTypes) ? rawTypes : rawTypes == null ? [] : [rawTypes]) {
    node.types.push(normalizeTerm(String(type)));
  }
  if (typeof value["@id"] === "string") node.id = value["@id"];

  for (const [key, raw] of Object.entries(value)) {
    if (key.startsWith("@")) continue;
    const values = jsonLdValues(raw, schemaOrg, jsonPathFor(path, key), label);
    node.properties.push({ name: normalizeTerm(key), values });
  }
  return node;
}

function jsonLdValues(raw: unknown, schemaOrg: boolean, path: string, label: string): SdValue[] {
  if (raw == null) return [];
  if (Array.isArray(raw)) return raw.flatMap((item, index) => jsonLdValues(item, schemaOrg, jsonPathFor(path, index), label));
  if (typeof raw === "string" || typeof raw === "number" || typeof raw === "boolean") return [{ kind: "literal", value: raw }];
  if (typeof raw === "object") {
    const object = raw as Record<string, unknown>;
    if ("@value" in object) {
      const literal = object["@value"];
      return typeof literal === "string" || typeof literal === "number" || typeof literal === "boolean" ? [{ kind: "literal", value: literal }] : [];
    }
    if (Array.isArray(object["@list"])) return jsonLdValues(object["@list"], schemaOrg, jsonPathFor(path, "@list"), label);
    const keys = Object.keys(object);
    if (keys.length === 1 && typeof object["@id"] === "string") return [{ kind: "ref", id: object["@id"] }];
    return [{ kind: "node", node: jsonLdNode(object, schemaOrg, path, label) }];
  }
  return [];
}

function extractJsonLdBlock(text: string, block: number, lineOffset: number, out: Extraction) {
  out.counts["json-ld"] += 1;
  const label = `JSON-LD block ${block}`;
  const leading = text.length - text.trimStart().length;
  const skippedLines = (text.slice(0, leading).match(/\n/g) ?? []).length;
  const cleaned = text.trim().replace(/^<!--/, "").replace(/-->$/, "").trim();
  if (!cleaned) {
    out.syntaxIssues.push({ format: "json-ld", block, message: "The JSON-LD script is empty." });
    return;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch (error) {
    const location = parseErrorLocation(error, cleaned);
    const issue: SyntaxIssue = { format: "json-ld", block, message: location.message };
    if (location.line) {
      issue.line = location.line + lineOffset + skippedLines;
      issue.column = location.column;
    }
    out.syntaxIssues.push(issue);
    return;
  }

  for (const duplicate of findDuplicateKeys(cleaned)) {
    const unique = duplicate.key.startsWith("@");
    out.syntaxIssues.push({
      format: "json-ld",
      block,
      severity: unique ? "error" : "warning",
      line: duplicate.line + lineOffset + skippedLines,
      path: `JSON-LD block ${block}, line ${duplicate.line + lineOffset + skippedLines}`,
      message: unique
        ? `Duplicate unique property: "${duplicate.key}" appears twice in the same object.`
        : `"${duplicate.key}" appears twice in the same object, so only the last value is kept.`,
      fix: unique ? `Keep a single ${duplicate.key}.` : `Merge the values into one array, for example "${duplicate.key}": ["first", "second"].`,
    });
  }

  const roots = Array.isArray(parsed) ? parsed.map((item, index) => ({ item, path: `$[${index}]` })) : [{ item: parsed, path: "$" }];
  for (const { item, path } of roots) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const object = item as Record<string, unknown>;
    const hasContext = "@context" in object;
    const schemaOrg = hasContext ? contextIsSchemaOrg(object["@context"]) : true;
    if (!hasContext) {
      out.contextIssues.push({ block, severity: "error", message: `${label} ${path} has no @context.`, fix: 'Add "@context": "https://schema.org" to the top-level object so parsers read the terms as schema.org.' });
    } else if (!schemaOrg) {
      out.contextIssues.push({ block, severity: "info", message: `${label} ${path} uses a @context that isn't schema.org, so its terms weren't checked against the schema.org vocabulary.`, fix: 'Use "@context": "https://schema.org" for markup meant for Google rich results.' });
    }
    const graph = object["@graph"];
    if (Array.isArray(graph)) {
      graph.forEach((member, index) => {
        if (member && typeof member === "object" && !Array.isArray(member)) {
          out.nodes.push(jsonLdNode(member as Record<string, unknown>, schemaOrg, `${path}["@graph"][${index}]`, label));
        }
      });
    }
    const ownKeys = Object.keys(object).filter((key) => key !== "@context" && key !== "@graph");
    if (ownKeys.length > 0) out.nodes.push(jsonLdNode(object, schemaOrg, path, label));
  }
}

// ---------------------------------------------------------------------------------------------
// Microdata (WHATWG HTML microdata, the parts search engines use)

function microdataValue(element: DomElement): string {
  const attribute = (name: string) => element.attribs[name] ?? "";
  switch (element.name) {
    case "meta":
      return attribute("content");
    case "audio": case "embed": case "iframe": case "img": case "source": case "track": case "video":
      return attribute("src");
    case "a": case "area": case "link":
      return attribute("href");
    case "object":
      return attribute("data");
    case "data": case "meter":
      return attribute("value");
    case "time":
      return hasAttr(element, "datetime") ? attribute("datetime") : collapse(textContent(element));
    default:
      return hasAttr(element, "content") ? attribute("content") : collapse(textContent(element));
  }
}

function splitTokens(value: string | undefined): string[] {
  return (value ?? "").split(/\s+/).filter(Boolean);
}

function microdataItem(element: DomElement, idIndex: Map<string, DomElement>, path: string, inheritedSchemaOrg: boolean, seen: Set<DomElement>, missingRefs: Array<{ ref: string; path: string }>): SdNode {
  const itemTypes = splitTokens(element.attribs.itemtype);
  const schemaOrg = itemTypes.length ? itemTypes.some(isSchemaOrgIri) : inheritedSchemaOrg;
  const node: SdNode = {
    types: itemTypes.map((type) => (isSchemaOrgIri(type) ? localName(type) : type)),
    properties: [],
    format: "microdata",
    path,
    schemaOrg,
  };
  if (element.attribs.itemid) node.id = element.attribs.itemid;
  seen.add(element);

  const pending: DomNode[] = [...element.children];
  for (const ref of splitTokens(element.attribs.itemref)) {
    const target = idIndex.get(ref);
    if (target) pending.push(target);
    else missingRefs.push({ ref, path });
  }
  const visited = new Set<DomNode>();
  while (pending.length) {
    const current = pending.shift() as DomNode;
    if (visited.has(current) || !isElement(current)) continue;
    visited.add(current);
    const names = splitTokens(current.attribs.itemprop);
    if (names.length) {
      const value: SdValue = hasAttr(current, "itemscope")
        ? seen.has(current)
          ? { kind: "literal", value: "(recursive item reference)" }
          : { kind: "node", node: microdataItem(current, idIndex, `${path} › ${names[0]}`, schemaOrg, seen, missingRefs) }
        : { kind: "literal", value: microdataValue(current) };
      for (const name of names) {
        const propertyName = isSchemaOrgIri(name) ? localName(name) : name;
        const existing = node.properties.find((property) => property.name === propertyName);
        if (existing) existing.values.push(value);
        else node.properties.push({ name: propertyName, values: [value] });
      }
    }
    if (!hasAttr(current, "itemscope")) pending.push(...current.children);
  }
  return node;
}

// ---------------------------------------------------------------------------------------------
// RDFa Lite (vocab, typeof, property, resource, prefix)

const DEFAULT_PREFIXES: Record<string, string> = { schema: "https://schema.org/" };

interface RdfaContext { vocab?: string; prefixes: Record<string, string>; subject?: SdNode }

function expandRdfaTerm(term: string, context: RdfaContext): string {
  const colon = term.indexOf(":");
  if (colon > 0 && !term.startsWith("http")) {
    const prefix = term.slice(0, colon);
    const base = context.prefixes[prefix];
    if (base) return `${base}${term.slice(colon + 1)}`;
    return term;
  }
  if (term.startsWith("http")) return term;
  return context.vocab ? `${context.vocab}${term}` : term;
}

function rdfaTermName(iri: string): string {
  return isSchemaOrgIri(iri) ? localName(iri) : iri;
}

function addRdfaProperty(subject: SdNode, name: string, value: SdValue) {
  const existing = subject.properties.find((property) => property.name === name);
  if (existing) existing.values.push(value);
  else subject.properties.push({ name, values: [value] });
}

function walkRdfa(node: DomNode, context: RdfaContext, out: Extraction, counter: { value: number }) {
  if (!isElement(node)) {
    for (const child of (node as { children?: DomNode[] }).children ?? []) walkRdfa(child, context, out, counter);
    return;
  }
  let next: RdfaContext = context;
  if (hasAttr(node, "vocab") || hasAttr(node, "prefix")) {
    const prefixes = { ...context.prefixes };
    const tokens = splitTokens(node.attribs.prefix);
    for (let index = 0; index + 1 < tokens.length; index += 2) prefixes[tokens[index].replace(/:$/, "")] = tokens[index + 1];
    next = { ...context, vocab: hasAttr(node, "vocab") ? node.attribs.vocab || undefined : context.vocab, prefixes };
  }

  const properties = splitTokens(node.attribs.property).map((term) => rdfaTermName(expandRdfaTerm(term, next)));
  if (hasAttr(node, "typeof")) {
    const types = splitTokens(node.attribs.typeof).map((term) => expandRdfaTerm(term, next));
    const item: SdNode = {
      types: types.map(rdfaTermName),
      properties: [],
      format: "rdfa",
      path: context.subject && properties.length ? `${context.subject.path} › ${properties[0]}` : `RDFa item ${counter.value + 1}`,
      schemaOrg: types.some(isSchemaOrgIri),
    };
    const id = node.attribs.resource ?? node.attribs.about;
    if (id) item.id = id;
    if (context.subject && properties.length) {
      for (const name of properties) addRdfaProperty(context.subject, name, { kind: "node", node: item });
    } else {
      counter.value += 1;
      out.counts.rdfa += 1;
      out.nodes.push(item);
    }
    next = { ...next, subject: item };
  } else if (properties.length && context.subject) {
    const attribute = (name: string) => node.attribs[name];
    const literal = attribute("content") ?? attribute("resource") ?? attribute("href") ?? attribute("src") ?? attribute("datetime") ?? collapse(textContent(node));
    for (const name of properties) addRdfaProperty(context.subject, name, { kind: "literal", value: literal });
  }
  for (const child of node.children) walkRdfa(child, next, out, counter);
}

// ---------------------------------------------------------------------------------------------

function lineAt(html: string, index: number | null): number {
  if (index == null) return 0;
  let line = 0;
  for (let position = 0; position < index; position += 1) if (html.charCodeAt(position) === 10) line += 1;
  return line;
}

export function looksLikeJson(input: string): boolean {
  const trimmed = input.trim();
  return trimmed.startsWith("{") || trimmed.startsWith("[");
}

/** Extracts structured data from raw JSON-LD or from an HTML document/fragment. */
export function extractStructuredData(input: string): Extraction {
  const out: Extraction = { nodes: [], syntaxIssues: [], counts: emptyCounts(), contextIssues: [] };
  if (looksLikeJson(input)) {
    extractJsonLdBlock(input, 1, 0, out);
    return out;
  }

  const document = parseDocument(input, { withStartIndices: true }) as unknown as DomNode;
  const idIndex = new Map<string, DomElement>();
  const scripts: DomElement[] = [];
  const topItems: DomElement[] = [];
  let hasRdfa = false;

  const walk = (node: DomNode) => {
    if (isElement(node)) {
      if (node.attribs.id) idIndex.set(node.attribs.id, node);
      if (node.name === "script" && /application\/ld\+json/i.test(node.attribs.type ?? "")) scripts.push(node);
      if (hasAttr(node, "itemscope") && !hasAttr(node, "itemprop")) topItems.push(node);
      if (hasAttr(node, "typeof") || hasAttr(node, "property")) hasRdfa = true;
    }
    for (const child of (node as { children?: DomNode[] }).children ?? []) walk(child);
  };
  walk(document);

  scripts.forEach((script, index) => {
    // The script's text starts on the line of its opening tag (lineAt counts the newlines before it).
    extractJsonLdBlock(textContent(script), index + 1, lineAt(input, script.startIndex), out);
  });

  const missingRefs: Array<{ ref: string; path: string }> = [];
  topItems.forEach((element, index) => {
    out.counts.microdata += 1;
    out.nodes.push(microdataItem(element, idIndex, `Microdata item ${index + 1}`, false, new Set(), missingRefs));
  });
  for (const missing of missingRefs) {
    out.syntaxIssues.push({ format: "microdata", block: 0, severity: "error", path: missing.path, message: `Reference to nonexistent item: itemref "${missing.ref}" doesn't match any element id on the page.`, fix: `Add id="${missing.ref}" to the element that holds those properties, or remove it from itemref.` });
  }

  if (hasRdfa) walkRdfa(document, { prefixes: { ...DEFAULT_PREFIXES } }, out, { value: 0 });

  return out;
}
