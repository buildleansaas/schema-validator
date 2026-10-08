// Shared types for the structured data validator. This module has no Next.js or DOM
// dependencies so it can be published as a standalone package later.

export type MarkupFormat = "json-ld" | "microdata" | "rdfa";

export type SdValue =
  | { kind: "literal"; value: string | number | boolean }
  | { kind: "node"; node: SdNode }
  | { kind: "ref"; id: string };

export interface SdNode {
  /** Schema.org-local type names, e.g. "Product". Non-schema.org types keep their full IRI. */
  types: string[];
  id?: string;
  properties: Array<{ name: string; values: SdValue[] }>;
  format: MarkupFormat;
  /** Human-readable location, e.g. "JSON-LD block 1 › $.offers". */
  path: string;
  /** False when the markup does not use the schema.org vocabulary, so vocabulary checks are skipped. */
  schemaOrg: boolean;
}

export interface SyntaxIssue {
  format: MarkupFormat;
  block: number;
  message: string;
  line?: number;
  column?: number;
  /** Set for non-parse problems (duplicate keys, broken itemref); parse errors are always errors. */
  severity?: "error" | "warning";
  path?: string;
  fix?: string;
}

export interface Extraction {
  nodes: SdNode[];
  syntaxIssues: SyntaxIssue[];
  counts: Record<MarkupFormat, number>;
  /** Top-level JSON-LD issues that are not parse errors (missing @context and similar). */
  contextIssues: Array<{ block: number; severity: "error" | "info"; message: string; fix: string }>;
}

export type IssueSeverity = "error" | "warning" | "info";
export type IssueCategory = "syntax" | "vocabulary" | "google" | "graph";

export interface ValidationIssue {
  severity: IssueSeverity;
  category: IssueCategory;
  message: string;
  fix?: string;
  /** Node location, e.g. "JSON-LD block 1 › $.offers". */
  path?: string;
  type?: string;
  property?: string;
  docsUrl?: string;
}

export type FeatureStatus = "supported" | "limited" | "retired";
export type FeatureResult = "eligible" | "missing-required" | "retired";

export interface FeatureReport {
  id: string;
  name: string;
  docsUrl: string;
  status: FeatureStatus;
  statusNote?: string;
  result: FeatureResult;
  /** The node the feature was detected on. */
  path: string;
  type: string;
  missingRequired: string[];
  missingRecommended: string[];
}

export interface ValidationReport {
  counts: Record<MarkupFormat, number>;
  types: string[];
  nodes: SdNode[];
  issues: ValidationIssue[];
  features: FeatureReport[];
  totals: { errors: number; warnings: number; infos: number };
  vocabularyVersion: string;
  googleRulesVerified: string;
}
