#!/usr/bin/env node
// schema-validate: validate structured data in files, directories, or URLs.
import fs from "node:fs";
import path from "node:path";
import { validateMarkup } from "../dist/index.js";

const HELP = `Usage: schema-validate [options] <file | directory | url> ...

Validates JSON-LD, microdata, and RDFa against the schema.org vocabulary and
Google's rich result requirements. Directories are scanned for .html, .htm,
.json, and .jsonld files.

Options:
  --json            Print the full reports as JSON
  --fail-on <level> Exit with code 1 on "error" (default), "warning", or "never"
  --quiet           Only print files that have issues at or above --fail-on
  -h, --help        Show this help

Examples:
  npx @buildleansaas/schema-validator ./out
  npx @buildleansaas/schema-validator https://example.com/product/1 --json
`;

const args = process.argv.slice(2);
if (!args.length || args.includes("-h") || args.includes("--help")) {
  console.log(HELP);
  process.exit(args.length ? 0 : 1);
}
const json = args.includes("--json");
const quiet = args.includes("--quiet");
const failIndex = args.indexOf("--fail-on");
const failOn = failIndex >= 0 ? args[failIndex + 1] : "error";
if (!["error", "warning", "never"].includes(failOn)) {
  console.error(`--fail-on must be error, warning, or never (got ${failOn})`);
  process.exit(2);
}
const targets = args.filter((arg, index) => !arg.startsWith("--") && args[index - 1] !== "--fail-on");

const EXTENSIONS = new Set([".html", ".htm", ".json", ".jsonld"]);
function collect(target) {
  if (/^https?:\/\//.test(target)) return [target];
  const stat = fs.statSync(target);
  if (stat.isFile()) return [target];
  return fs.readdirSync(target, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) return [];
    const full = path.join(target, entry.name);
    if (entry.isDirectory()) return collect(full);
    return EXTENSIONS.has(path.extname(entry.name).toLowerCase()) ? [full] : [];
  });
}

async function read(target) {
  if (!/^https?:\/\//.test(target)) return fs.readFileSync(target, "utf8");
  const response = await fetch(target, { headers: { "user-agent": "schema-validate (+https://github.com/buildleansaas/schema-validator)" } });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.text();
}

const SEVERITY = { error: 2, warning: 1, info: 0 };
const threshold = failOn === "warning" ? 1 : failOn === "error" ? 2 : Infinity;
let failed = false;
const results = [];

for (const target of targets.flatMap(collect)) {
  let report;
  try {
    report = validateMarkup(await read(target));
  } catch (error) {
    console.error(`${target}: ${error.message}`);
    failed = true;
    continue;
  }
  const worst = Math.max(-1, ...report.issues.map((issue) => SEVERITY[issue.severity]));
  if (worst >= threshold) failed = true;
  if (json) {
    results.push({ target, ...report, nodes: undefined });
    continue;
  }
  if (quiet && worst < threshold) continue;
  const { errors, warnings, infos } = report.totals;
  const plural = (count, word) => `${count} ${word}${count === 1 ? "" : "s"}`;
  console.log(`\n${target}  ${plural(errors, "error")}, ${plural(warnings, "warning")}, ${plural(infos, "note")}`);
  for (const feature of report.features) {
    const detail = feature.missingRequired.length ? ` (missing ${feature.missingRequired.join(", ")})` : "";
    console.log(`  ${feature.result === "eligible" ? "✓" : feature.result === "retired" ? "–" : "✗"} ${feature.name} [${feature.type}]${detail}`);
  }
  for (const issue of report.issues.filter((item) => item.severity !== "info" || !quiet)) {
    console.log(`  ${issue.severity.padEnd(7)} ${issue.message}${issue.path ? `  (${issue.path})` : ""}`);
    if (issue.fix) console.log(`          fix: ${issue.fix}`);
  }
}

if (json) console.log(JSON.stringify(results, null, 2));
process.exit(failed ? 1 : 0);
