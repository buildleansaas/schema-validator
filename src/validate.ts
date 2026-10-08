import { extractStructuredData } from "./extract";
import { GOOGLE_FEATURES, GOOGLE_RULES_VERIFIED, RETIRED_FEATURES, REVIEWABLE_TYPES, type FeatureDefinition, type Requirement } from "./google-features";
import type { Extraction, FeatureReport, SdNode, SdValue, ValidationIssue, ValidationReport } from "./types";
import {
  basePropertyName,
  getProperty,
  getType,
  isDataTypeName,
  isEnumerationMember,
  isSubtypeOf,
  localName,
  propertyAppliesTo,
  suggestProperty,
  suggestType,
  vocabularyVersion,
} from "./vocab";

interface NodeContext {
  parent?: SdNode;
  via?: string;
  top: boolean;
}

const SCHEMA_DOCS = "https://schema.org/";
/** Superseded schema.org terms that Google's current docs still use (LocalBusiness "menu"). */
const GOOGLE_DOCUMENTED_LEGACY = new Set(["menu"]);
const isForeignTerm = (term: string) => term.includes(":") || term.includes("/");

class Graph {
  readonly all: SdNode[] = [];
  readonly context = new Map<SdNode, NodeContext>();
  readonly byId = new Map<string, SdNode[]>();

  constructor(roots: SdNode[]) {
    const visit = (node: SdNode, context: NodeContext) => {
      if (this.context.has(node)) return;
      this.context.set(node, context);
      this.all.push(node);
      if (node.id) this.byId.set(node.id, [...(this.byId.get(node.id) ?? []), node]);
      for (const property of node.properties) {
        for (const value of property.values) {
          if (value.kind === "node") visit(value.node, { parent: node, via: property.name, top: false });
        }
      }
    };
    for (const root of roots) visit(root, { top: true });
  }

  /** Nodes that share an @id describe the same entity; Google merges them. */
  aliases(node: SdNode): SdNode[] {
    return node.id ? this.byId.get(node.id) ?? [node] : [node];
  }

  types(node: SdNode): string[] {
    return Array.from(new Set(this.aliases(node).flatMap((alias) => alias.types)));
  }

  resolve(value: SdValue): SdNode[] {
    if (value.kind === "node") return [value.node];
    if (value.kind === "ref") return this.byId.get(value.id) ?? [];
    return [];
  }

  propertyValues(node: SdNode, name: string): SdValue[] {
    return this.aliases(node).flatMap((alias) => alias.properties.filter((property) => property.name === name).flatMap((property) => property.values));
  }

  /** Values at a dotted path. A leading "^" reads from the parent node. */
  valuesAt(node: SdNode, path: string): SdValue[] {
    let current: SdNode[] = [node];
    let segments = path.split(".");
    if (segments[0].startsWith("^")) {
      const parent = this.context.get(node)?.parent;
      if (!parent) return [];
      current = [parent];
      segments = [segments[0].slice(1), ...segments.slice(1)];
    }
    let values: SdValue[] = [];
    segments.forEach((segment, index) => {
      values = current.flatMap((item) => this.propertyValues(item, segment));
      if (index < segments.length - 1) current = values.flatMap((value) => this.resolve(value));
    });
    return values;
  }

  has(node: SdNode, path: string): boolean {
    return path.split("+").every((part) =>
      this.valuesAt(node, part).some((value) => (value.kind === "literal" ? String(value.value).trim() !== "" : true)),
    );
  }
}

/** Items Google reads as standalone results rather than as values of another item. */
const STANDALONE_VIA = new Set(["item", "mainEntity"]);
const isStandalone = (context: NodeContext) => context.top || (context.via !== undefined && STANDALONE_VIA.has(context.via));

const matchesAny = (types: string[], targets: string[]) => types.some((type) => targets.some((target) => isSubtypeOf(type, target)));

function requirementLabel(requirement: Requirement): string {
  return requirement.label ?? requirement.anyOf.join(" or ");
}

// ---------------------------------------------------------------------------------------------
// Vocabulary checks

const ISO_DATE = /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/;
const ISO_DURATION = /^P(?!$)(\d+Y)?(\d+M)?(\d+W)?(\d+D)?(T(?=\d)(\d+H)?(\d+M)?(\d+(\.\d+)?S)?)?$/;

function checkLiteral(property: string, ranges: string[], value: string | number | boolean, node: SdNode, issues: ValidationIssue[]) {
  if (typeof value !== "string") return;
  const text = value.trim();
  if (!text) {
    issues.push({ severity: "warning", category: "vocabulary", path: node.path, property, message: `${property} is empty.`, fix: `Remove ${property} or give it a value.` });
    return;
  }
  // Only check formats when every expected type is that kind of literal; Text alternatives allow anything.
  if (ranges.length && ranges.every((range) => range === "Date" || range === "DateTime")) {
    if (!ISO_DATE.test(text)) {
      issues.push({ severity: "warning", category: "vocabulary", path: node.path, property, message: `${property} "${text}" isn't an ISO 8601 date.`, fix: 'Use a format like "2026-10-07" or "2026-10-07T09:00:00-04:00".', docsUrl: `${SCHEMA_DOCS}${property}` });
    }
  } else if (ranges.length && ranges.every((range) => range === "Duration")) {
    if (!ISO_DURATION.test(text)) {
      issues.push({ severity: "warning", category: "vocabulary", path: node.path, property, message: `${property} "${text}" isn't an ISO 8601 duration.`, fix: 'Use a format like "PT30M" (30 minutes) or "PT1H15M".', docsUrl: `${SCHEMA_DOCS}${property}` });
    }
  } else if (ranges.length && ranges.every((range) => range === "Number" || range === "Integer" || range === "Float")) {
    if (!/^-?\d+(\.\d+)?$/.test(text.replace(/,/g, ""))) {
      issues.push({ severity: "warning", category: "vocabulary", path: node.path, property, message: `${property} "${text}" isn't a number.`, fix: "Use digits only, without currency symbols or units.", docsUrl: `${SCHEMA_DOCS}${property}` });
    }
  } else if (ranges.length && ranges.every((range) => range === "URL")) {
    if (/\s/.test(text)) {
      issues.push({ severity: "warning", category: "vocabulary", path: node.path, property, message: `${property} "${text}" doesn't look like a URL.`, fix: "Use an absolute URL such as https://example.com/page.", docsUrl: `${SCHEMA_DOCS}${property}` });
    }
  }
  // Enumeration values written as schema.org URLs, e.g. availability "https://schema.org/InStok".
  const enumerationRanges = ranges.filter((range) => !isDataTypeName(range) && isSubtypeOf(range, "Enumeration"));
  if (enumerationRanges.length && /^https?:\/\/schema\.org\//i.test(text)) {
    const member = localName(text);
    if (!isEnumerationMember(member) && !getType(member)) {
      issues.push({ severity: "error", category: "vocabulary", path: node.path, property, message: `"${text}" isn't a schema.org ${enumerationRanges[0]} value.`, fix: `Use one of the ${enumerationRanges[0]} values listed on schema.org.`, docsUrl: `${SCHEMA_DOCS}${enumerationRanges[0]}` });
    }
  }
}

function checkVocabulary(graph: Graph, issues: ValidationIssue[]) {
  for (const node of graph.all) {
    if (!node.schemaOrg) continue;
    const context = graph.context.get(node) as NodeContext;
    const types = graph.types(node);
    const schemaTypes = types.filter((type) => !isForeignTerm(type));

    if (types.length === 0 && !node.id) {
      issues.push({
        severity: context.top ? "error" : "warning",
        category: "vocabulary",
        path: node.path,
        message: context.top ? "This item has no @type." : `The ${context.via ?? "nested"} object has no @type.`,
        fix: context.top ? "Add a schema.org @type such as Organization, Product, or Article." : "Add an @type (for example PostalAddress, Offer, or Person) so its properties can be checked.",
      });
    }

    for (const type of node.types) {
      if (isForeignTerm(type)) continue;
      const definition = getType(type);
      if (!definition) {
        if (getProperty(type)) {
          issues.push({ severity: "error", category: "vocabulary", path: node.path, type, message: `${type} is a schema.org property, not a type.`, fix: `Use a type for @type (types start with a capital letter) and put ${type} inside the item as a property.`, docsUrl: `${SCHEMA_DOCS}${type}` });
        } else if (isEnumerationMember(type)) {
          issues.push({ severity: "error", category: "vocabulary", path: node.path, type, message: `${type} is an enumeration value, not a type.`, fix: `Use ${type} as a property value (for example https://schema.org/${type}), not as @type.`, docsUrl: `${SCHEMA_DOCS}${type}` });
        } else {
          const suggestion = suggestType(type);
          issues.push({ severity: "error", category: "vocabulary", path: node.path, type, message: `${type} isn't a schema.org type.`, fix: suggestion ? `Did you mean ${suggestion}?` : "Check the spelling against schema.org (types are case-sensitive).", docsUrl: suggestion ? `${SCHEMA_DOCS}${suggestion}` : SCHEMA_DOCS });
        }
        continue;
      }
      if (definition.supersededBy) {
        issues.push({ severity: "warning", category: "vocabulary", path: node.path, type, message: `${type} has been superseded by ${definition.supersededBy}.`, fix: `Use ${definition.supersededBy} instead.`, docsUrl: `${SCHEMA_DOCS}${definition.supersededBy}` });
      } else if (definition.pending) {
        issues.push({ severity: "info", category: "vocabulary", path: node.path, type, message: `${type} is a pending schema.org type, so it may change.`, docsUrl: `${SCHEMA_DOCS}${type}` });
      }
    }
    const typesKnown = schemaTypes.length > 0 && schemaTypes.every((type) => getType(type));

    for (const property of node.properties) {
      if (isForeignTerm(property.name)) continue;
      const base = basePropertyName(property.name);
      const definition = getProperty(base);
      if (!definition) {
        const suggestion = suggestProperty(base, schemaTypes);
        issues.push({ severity: "error", category: "vocabulary", path: node.path, property: property.name, message: `${property.name} isn't a schema.org property.`, fix: suggestion ? `Did you mean ${suggestion}?` : "Check the spelling against schema.org (properties are case-sensitive).", docsUrl: suggestion ? `${SCHEMA_DOCS}${suggestion}` : SCHEMA_DOCS });
        continue;
      }
      // "-input"/"-output" annotations on Actions constrain a field of the action's target, so
      // the property's own domain doesn't apply to the action (Google's MathSolver uses this).
      const annotated = base !== property.name;
      if (typesKnown && !annotated && !propertyAppliesTo(base, schemaTypes)) {
        issues.push({ severity: "error", category: "vocabulary", path: node.path, property: property.name, type: schemaTypes.join(", "), message: `${property.name} isn't a property of ${schemaTypes.join(" or ")} in schema.org.`, fix: `Move it to an object it belongs to (expected on ${definition.domains.slice(0, 4).join(", ")}${definition.domains.length > 4 ? ", …" : ""}) or remove it.`, docsUrl: `${SCHEMA_DOCS}${base}` });
      }
      if (definition.supersededBy && GOOGLE_DOCUMENTED_LEGACY.has(base)) {
        issues.push({ severity: "info", category: "vocabulary", path: node.path, property: property.name, message: `schema.org superseded ${property.name} with ${definition.supersededBy}, but Google's docs still use ${property.name}, so either works.`, docsUrl: `${SCHEMA_DOCS}${definition.supersededBy}` });
      } else if (definition.supersededBy) {
        issues.push({ severity: "warning", category: "vocabulary", path: node.path, property: property.name, message: `${property.name} has been superseded by ${definition.supersededBy}.`, fix: `Use ${definition.supersededBy} instead.`, docsUrl: `${SCHEMA_DOCS}${definition.supersededBy}` });
      } else if (definition.pending) {
        issues.push({ severity: "info", category: "vocabulary", path: node.path, property: property.name, message: `${property.name} is a pending schema.org property, so it may change.`, docsUrl: `${SCHEMA_DOCS}${base}` });
      }

      const entityRanges = definition.ranges.filter((range) => !isDataTypeName(range));
      for (const value of property.values) {
        if (value.kind === "literal") {
          checkLiteral(property.name, definition.ranges, value.value, node, issues);
          continue;
        }
        if (value.kind === "ref") {
          if (!graph.byId.has(value.id)) {
            issues.push({ severity: "info", category: "graph", path: node.path, property: property.name, message: `${property.name} points to @id "${value.id}", which isn't defined in this markup.`, fix: "That's fine if another item on the same page defines it. Otherwise add the item or use a full object." });
          }
          continue;
        }
        const valueTypes = value.node.types.filter((type) => !isForeignTerm(type) && getType(type));
        if (!valueTypes.length || !entityRanges.length) continue;
        if (valueTypes.some((type) => isSubtypeOf(type, "Role"))) continue;
        if (!matchesAny(valueTypes, entityRanges)) {
          issues.push({ severity: "warning", category: "vocabulary", path: value.node.path, property: property.name, type: valueTypes.join(", "), message: `${property.name} expects ${entityRanges.slice(0, 4).join(" or ")}, but this value is ${valueTypes.join(", ")}.`, fix: `Change the @type to ${entityRanges[0]} (or a subtype) if that matches the content.`, docsUrl: `${SCHEMA_DOCS}${base}` });
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Value checks from schema.org usage notes and Google's docs (price, currency, rating scale)

const firstLiteral = (graph: Graph, node: SdNode, property: string): string | undefined => {
  const value = graph.propertyValues(node, property).find((item) => item.kind === "literal");
  return value && value.kind === "literal" ? String(value.value).trim() : undefined;
};

function checkValues(graph: Graph, node: SdNode, types: string[], issues: ValidationIssue[]) {
  if (matchesAny(types, ["Offer", "PriceSpecification", "Demand"])) {
    for (const property of ["price", "lowPrice", "highPrice"]) {
      const raw = graph.propertyValues(node, property).find((item) => item.kind === "literal");
      if (!raw || raw.kind !== "literal" || typeof raw.value !== "string") continue;
      const text = raw.value.trim();
      if (text && !/^\d+(\.\d+)?$/.test(text)) {
        issues.push({ severity: "warning", category: "vocabulary", path: node.path, property, message: `${property} "${text}" should be a plain number.`, fix: 'Use digits with a "." for decimals and no currency symbol or thousands separator (for example "1299.99"). Put the currency in priceCurrency.', docsUrl: `${SCHEMA_DOCS}price` });
      }
    }
    const currency = firstLiteral(graph, node, "priceCurrency");
    if (currency && !/^[A-Z]{3,5}$/.test(currency)) {
      issues.push({ severity: "warning", category: "vocabulary", path: node.path, property: "priceCurrency", message: `priceCurrency "${currency}" isn't an ISO 4217 code.`, fix: 'Use the three-letter uppercase code, for example "USD", "EUR", or "GBP", not a symbol.', docsUrl: `${SCHEMA_DOCS}priceCurrency` });
    }
  }
  if (matchesAny(types, ["Rating"])) {
    const value = Number(firstLiteral(graph, node, "ratingValue"));
    const bestText = firstLiteral(graph, node, "bestRating");
    const worstText = firstLiteral(graph, node, "worstRating");
    const best = bestText === undefined ? 5 : Number(bestText);
    const worst = worstText === undefined ? 1 : Number(worstText);
    const ratingText = firstLiteral(graph, node, "ratingValue");
    if (ratingText !== undefined && /^-?\d+(\.\d+)?$/.test(ratingText) && Number.isFinite(best) && Number.isFinite(worst) && (value > best || value < worst)) {
      issues.push({
        severity: "error", category: "google", path: node.path, property: "ratingValue",
        message: `ratingValue ${ratingText} is outside the rating scale (${worst}–${best}${bestText === undefined ? ", Google's default 5-point scale" : ""}).`,
        fix: bestText === undefined ? "Add bestRating (and worstRating) if you use a scale other than 1–5." : "Check the rating value against bestRating and worstRating.",
        docsUrl: "https://developers.google.com/search/docs/appearance/structured-data/review-snippet",
      });
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Google rich-result checks

function checkFeature(graph: Graph, node: SdNode, feature: FeatureDefinition): FeatureReport {
  const context = graph.context.get(node) as NodeContext;
  const type = graph.types(node).find((candidate) => feature.types.some((target) => isSubtypeOf(candidate, target))) ?? feature.types[0];
  const missingRequired: string[] = [];
  const missingRecommended: string[] = [];

  for (const requirement of feature.required) {
    if (requirement.unlessNestedVia && context.via && requirement.unlessNestedVia.includes(context.via)) continue;
    if (!requirement.anyOf.some((path) => graph.has(node, path))) missingRequired.push(requirementLabel(requirement));
  }
  for (const requirement of feature.recommended) {
    if (!requirement.anyOf.some((path) => graph.has(node, path))) missingRecommended.push(requirementLabel(requirement));
  }

  for (const rule of feature.nested ?? []) {
    const children = graph
      .valuesAt(node, rule.via)
      .flatMap((value) => graph.resolve(value))
      .filter((child) => {
        const childTypes = graph.types(child);
        if (rule.types && !matchesAny(childTypes, rule.types)) return false;
        return !(rule.excludeTypes && matchesAny(childTypes, rule.excludeTypes));
      });
    if (rule.requireOne && children.length === 0) missingRequired.push(`${rule.via} (${rule.label})`);
    children.forEach((child, index) => {
      const isLast = index === children.length - 1;
      const prefix = children.length > 1 ? `${rule.label} ${index + 1}` : rule.label;
      for (const requirement of rule.required ?? []) {
        if (isLast && rule.notForLast?.some((path) => requirement.anyOf.includes(path))) continue;
        if (!requirement.anyOf.some((path) => graph.has(child, path))) missingRequired.push(`${prefix}: ${requirementLabel(requirement)}`);
      }
      for (const requirement of rule.recommended ?? []) {
        const label = `${rule.label}: ${requirementLabel(requirement)}`;
        if (!requirement.anyOf.some((path) => graph.has(child, path)) && !missingRecommended.includes(label)) missingRecommended.push(label);
      }
    });
  }

  return {
    id: feature.id,
    name: feature.name,
    docsUrl: feature.docsUrl,
    status: feature.status,
    statusNote: feature.statusNote,
    result: missingRequired.length ? "missing-required" : "eligible",
    path: node.path,
    type,
    missingRequired,
    missingRecommended,
  };
}

function checkGoogle(graph: Graph, issues: ValidationIssue[]): FeatureReport[] {
  const reports: FeatureReport[] = [];
  const checkedIds = new Set<string>();
  for (const node of graph.all) {
    if (!node.schemaOrg) continue;
    // Check each @id entity once, on its first occurrence.
    if (node.id) {
      if (checkedIds.has(node.id)) continue;
      checkedIds.add(node.id);
    }
    const types = graph.types(node).filter((type) => getType(type));
    if (!types.length) continue;
    const context = graph.context.get(node) as NodeContext;

    for (const feature of GOOGLE_FEATURES) {
      if (!matchesAny(types, feature.types)) continue;
      if (feature.excludeTypes && matchesAny(types, feature.excludeTypes)) continue;
      if (!feature.matchNested && !isStandalone(context)) continue;
      if (feature.detectWhenAny && !feature.detectWhenAny.some((path) => graph.has(node, path))) continue;
      const report = checkFeature(graph, node, feature);
      reports.push(report);
      for (const missing of report.missingRequired) {
        issues.push({ severity: "error", category: "google", path: node.path, type: report.type, property: missing, message: `${feature.name}: missing required ${missing}.`, fix: `Add ${missing}. Without it, this ${report.type} isn't eligible for the ${feature.name} rich result.`, docsUrl: feature.docsUrl });
      }
      if (report.missingRecommended.length) {
        issues.push({ severity: "warning", category: "google", path: node.path, type: report.type, message: `${feature.name}: ${report.missingRecommended.length} recommended ${report.missingRecommended.length === 1 ? "property is" : "properties are"} missing (${report.missingRecommended.join(", ")}).`, fix: "Add the ones that are true and visible on the page. They're optional, but they make the result more complete.", docsUrl: feature.docsUrl });
      }
    }

    for (const retired of RETIRED_FEATURES) {
      if (!retired.types.length || !matchesAny(types, retired.types)) continue;
      if (retired.excludeTypes && matchesAny(types, retired.excludeTypes)) continue;
      reports.push({ id: `retired-${retired.name.toLowerCase().replace(/\W+/g, "-")}`, name: retired.name, docsUrl: retired.source, status: retired.status, statusNote: retired.note, result: "retired", path: node.path, type: types[0], missingRequired: [], missingRecommended: [] });
      issues.push({ severity: "info", category: "google", path: node.path, type: types[0], message: `${types[0]} is valid schema.org, but Google's ${retired.name} rich result is ${retired.status === "retired" ? "retired" : "limited"}: ${retired.note}`, fix: "Keep it if it describes the page accurately; just don't expect that rich result.", docsUrl: retired.source });
    }

    // The sitelinks search box was retired; SearchAction itself is still valid schema.org.
    if (matchesAny(types, ["WebSite"])) {
      const actions = graph.valuesAt(node, "potentialAction").flatMap((value) => graph.resolve(value));
      if (actions.some((action) => matchesAny(graph.types(action), ["SearchAction"]))) {
        issues.push({ severity: "info", category: "google", path: node.path, type: "WebSite", property: "potentialAction", message: "WebSite › SearchAction is valid schema.org, but Google retired the sitelinks search box it powered (documentation removed November 29, 2024).", fix: "It does no harm; remove it only if nothing else on your site uses it.", docsUrl: "https://developers.google.com/search/updates" });
      }
    }

    checkValues(graph, node, types, issues);

    // Review snippets only show for these reviewed item types.
    if (matchesAny(types, ["Review", "AggregateRating"]) && !matchesAny(types, ["EmployerAggregateRating"])) {
      const reviewed = graph.valuesAt(node, "itemReviewed").flatMap((value) => graph.resolve(value));
      const target = reviewed[0] ?? (context.via && ["review", "aggregateRating"].includes(context.via) ? context.parent : undefined);
      const targetTypes = target ? graph.types(target).filter((type) => getType(type)) : [];
      if (targetTypes.length && !matchesAny(targetTypes, REVIEWABLE_TYPES)) {
        issues.push({ severity: "warning", category: "google", path: node.path, type: types[0], message: `Google only shows review snippets for certain item types, and ${targetTypes.join(", ")} isn't one of them.`, fix: `Review a ${REVIEWABLE_TYPES.slice(0, 6).join(", ")}, or another supported type.`, docsUrl: "https://developers.google.com/search/docs/appearance/structured-data/review-snippet" });
      }
    }
  }
  return reports;
}

// ---------------------------------------------------------------------------------------------

// Maps the JSON parser's messages to the names Search Console uses in its Unparsable structured data report.
function googleParseErrorName(message: string): string | undefined {
  if (/Expected double-quoted property name/i.test(message)) return "Parsing error: Missing '}' or object member name — often a trailing comma";
  if (/Expected ',' or '}' after property value/i.test(message)) return "Parsing error: Missing ',' or '}'";
  if (/Expected ':' after property name/i.test(message)) return "Parsing error: Missing ':'";
  if (/Expected ',' or ']' after array element/i.test(message)) return "Parsing error: Missing ',' or ']' in array declaration";
  if (/Bad escaped character|Bad Unicode escape/i.test(message)) return "Bad escape sequence in string";
  if (/Unexpected end of JSON input|Unterminated string/i.test(message)) return "Invalid JSON document — the block ends early (missing a closing quote, brace, or bracket)";
  if (/Bad control character/i.test(message)) return "Invalid JSON document — a raw line break or tab inside a string";
  if (/Unexpected token|Unexpected non-whitespace/i.test(message)) return "Invalid JSON document";
  return undefined;
}

export function validateExtraction(extraction: Extraction): ValidationReport {
  const issues: ValidationIssue[] = [];
  for (const syntax of extraction.syntaxIssues) {
    if (syntax.format !== "json-ld") {
      issues.push({ severity: syntax.severity ?? "error", category: "syntax", message: syntax.message, path: syntax.path, fix: syntax.fix });
      continue;
    }
    if (syntax.severity) {
      issues.push({ severity: syntax.severity, category: "syntax", message: `JSON-LD block ${syntax.block}: ${syntax.message}`, path: syntax.path ?? `JSON-LD block ${syntax.block}`, fix: syntax.fix });
      continue;
    }
    const googleName = googleParseErrorName(syntax.message);
    issues.push({ severity: "error", category: "syntax", message: `JSON-LD block ${syntax.block}: ${googleName ? `${googleName} (${syntax.message})` : syntax.message}`, path: syntax.line ? `JSON-LD block ${syntax.block}, line ${syntax.line}${syntax.column ? `, column ${syntax.column}` : ""}` : `JSON-LD block ${syntax.block}`, fix: "Fix the JSON syntax (a missing comma, quote, or bracket is the usual cause). Google ignores a block it can't parse." });
  }
  for (const context of extraction.contextIssues) {
    issues.push({ severity: context.severity, category: "syntax", message: context.message, fix: context.fix, path: `JSON-LD block ${context.block}` });
  }

  const graph = new Graph(extraction.nodes);
  checkVocabulary(graph, issues);
  const features = checkGoogle(graph, issues);

  if (!extraction.nodes.length && !extraction.syntaxIssues.length) {
    issues.push({ severity: "info", category: "syntax", message: "No structured data found (no JSON-LD, microdata, or RDFa).", fix: "Paste JSON-LD, a <script type=\"application/ld+json\"> block, or HTML with microdata/RDFa." });
  }

  const order = { error: 0, warning: 1, info: 2 } as const;
  issues.sort((a, b) => order[a.severity] - order[b.severity]);

  return {
    counts: extraction.counts,
    types: Array.from(new Set(graph.all.flatMap((node) => node.types))),
    nodes: extraction.nodes,
    issues,
    features,
    totals: {
      errors: issues.filter((issue) => issue.severity === "error").length,
      warnings: issues.filter((issue) => issue.severity === "warning").length,
      infos: issues.filter((issue) => issue.severity === "info").length,
    },
    vocabularyVersion,
    googleRulesVerified: GOOGLE_RULES_VERIFIED,
  };
}

/** Validates raw JSON-LD or an HTML page/fragment containing JSON-LD, microdata, or RDFa. */
export function validateMarkup(input: string): ValidationReport {
  return validateExtraction(extractStructuredData(input));
}
