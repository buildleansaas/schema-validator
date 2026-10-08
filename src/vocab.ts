import vocabData from "./schemaorg-vocab.json";

interface VocabType {
  parents: string[];
  dataType?: boolean;
  pending?: boolean;
  supersededBy?: string;
}

interface VocabProperty {
  domains: string[];
  ranges: string[];
  pending?: boolean;
  supersededBy?: string;
}

interface Vocab {
  version: string;
  types: Record<string, VocabType>;
  properties: Record<string, VocabProperty>;
  enumerationMembers: Record<string, string[]>;
}

const vocab = vocabData as Vocab;

export const vocabularyVersion = vocab.version;

const SCHEMA_IRI = /^(?:https?:\/\/schema\.org\/|schema:)/i;

/** Returns the schema.org-local name for a term written as "schema:x", "https://schema.org/x" or "x". */
export function localName(term: string): string {
  return term.trim().replace(SCHEMA_IRI, "").replace(/\/$/, "");
}

export function isSchemaOrgIri(term: string): boolean {
  return SCHEMA_IRI.test(term.trim());
}

export function getType(name: string): VocabType | undefined {
  return Object.prototype.hasOwnProperty.call(vocab.types, name) ? vocab.types[name] : undefined;
}

export function getProperty(name: string): VocabProperty | undefined {
  return Object.prototype.hasOwnProperty.call(vocab.properties, name) ? vocab.properties[name] : undefined;
}

export function isEnumerationMember(name: string): boolean {
  return Object.prototype.hasOwnProperty.call(vocab.enumerationMembers, name);
}

const ancestorCache = new Map<string, Set<string>>();

/** The type itself plus every supertype. */
export function ancestors(type: string): Set<string> {
  const cached = ancestorCache.get(type);
  if (cached) return cached;
  const result = new Set<string>();
  const stack = [type];
  while (stack.length) {
    const current = stack.pop() as string;
    if (result.has(current)) continue;
    result.add(current);
    for (const parent of getType(current)?.parents ?? []) stack.push(parent);
  }
  ancestorCache.set(type, result);
  return result;
}

export function isSubtypeOf(type: string, parent: string): boolean {
  return ancestors(type).has(parent);
}

/**
 * Annotated action properties such as "mathExpression-input" and "query-input" are valid:
 * the suffix marks an input/output constraint on the underlying property.
 */
export function basePropertyName(name: string): string {
  return name.replace(/-(input|output)$/, "");
}

export function propertyAppliesTo(property: string, types: string[]): boolean {
  const definition = getProperty(basePropertyName(property));
  if (!definition) return false;
  return types.some((type) => definition.domains.some((domain) => isSubtypeOf(type, domain)));
}

export function isDataTypeName(name: string): boolean {
  return Boolean(getType(name)?.dataType);
}

function editDistance(a: string, b: string): number {
  const previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    let diagonal = previous[0];
    previous[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const above = previous[j];
      previous[j] = Math.min(previous[j] + 1, previous[j - 1] + 1, diagonal + (a[i - 1] === b[j - 1] ? 0 : 1));
      diagonal = above;
    }
  }
  return previous[b.length];
}

function closest(term: string, candidates: string[]): string | undefined {
  const lower = term.toLowerCase();
  const exactCase = candidates.find((candidate) => candidate.toLowerCase() === lower);
  if (exactCase) return exactCase;
  let best: string | undefined;
  let bestDistance = Math.max(2, Math.floor(term.length / 4)) + 1;
  for (const candidate of candidates) {
    if (Math.abs(candidate.length - term.length) >= bestDistance) continue;
    const distance = editDistance(lower, candidate.toLowerCase());
    if (distance < bestDistance) {
      best = candidate;
      bestDistance = distance;
    }
  }
  return best;
}

const typeNames = Object.keys(vocab.types);
const propertyNames = Object.keys(vocab.properties);

export function suggestType(term: string): string | undefined {
  return closest(term, typeNames);
}

/** Suggests a property, preferring ones that apply to the given types. */
export function suggestProperty(term: string, types: string[]): string | undefined {
  const applicable = propertyNames.filter((name) => propertyAppliesTo(name, types));
  return closest(term, applicable) ?? closest(term, propertyNames);
}

/** Expected value types (rangeIncludes) for a property. */
export function rangesOf(property: string): string[] {
  return getProperty(basePropertyName(property))?.ranges ?? [];
}
