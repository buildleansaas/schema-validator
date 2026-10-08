// Popup: reads the active tab's rendered HTML (so JSON-LD added by JavaScript counts) and validates it locally.
import { validateMarkup, type FeatureReport, type ValidationIssue, type ValidationReport } from "../../src/index";

declare const chrome: any;

const app = document.getElementById("app") as HTMLElement;
const SITE = "https://www.swiftschema.com";

const escape = (text: string) => text.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char] as string);
const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

function featureLabel(feature: FeatureReport) {
  if (feature.result === "retired") return `<span class="chip muted">${feature.status === "limited" ? "Limited" : "Retired"}</span>`;
  if (feature.result === "missing-required") return `<span class="chip error">Not eligible</span>`;
  return `<span class="chip ok">Eligible</span>`;
}

function issueItem(issue: ValidationIssue) {
  return `<li><div class="${issue.severity}">${escape(issue.message)}</div>${issue.fix ? `<div class="fix">${escape(issue.fix)}</div>` : ""}</li>`;
}

function render(report: ValidationReport) {
  const formats = Object.entries(report.counts).filter(([, count]) => count > 0).map(([format, count]) => `${count} ${format}`).join(", ");
  const { errors, warnings, infos } = report.totals;
  const features = report.features.map((feature) => `<li><div class="row"><strong>${escape(feature.name)}</strong>${featureLabel(feature)}</div><div class="muted">${escape(feature.type)}${feature.missingRequired.length ? ` · missing ${escape(feature.missingRequired.join(", "))}` : ""}</div></li>`).join("");
  const problems = report.issues.filter((issue) => issue.severity !== "info").slice(0, 25).map(issueItem).join("");
  const notes = report.issues.filter((issue) => issue.severity === "info").slice(0, 10).map(issueItem).join("");
  app.innerHTML = `
    <p class="summary"><span class="${errors ? "error" : ""}">${plural(errors, "error")}</span> · ${plural(warnings, "warning")} · ${plural(infos, "note")}</p>
    <p class="muted">${formats ? `Found ${escape(formats)}` : "No structured data found on this page."}</p>
    ${features ? `<h2>Google rich results</h2><ul>${features}</ul>` : ""}
    ${problems ? `<h2>Issues</h2><ul>${problems}</ul>` : ""}
    ${notes ? `<h2>Notes</h2><ul>${notes}</ul>` : ""}
    <p class="muted">schema.org ${escape(report.vocabularyVersion)} · Google rules verified ${escape(report.googleRulesVerified)}. Confirm in Google's Rich Results Test before relying on a rich result.</p>`;
}

async function main() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.url && /^https?:/.test(tab.url)) {
    const query = `?url=${encodeURIComponent(tab.url)}&utm_source=chrome-extension`;
    (document.getElementById("full-report") as HTMLAnchorElement).href = `${SITE}/tools/schema-validator${query}`;
    (document.getElementById("rich-results") as HTMLAnchorElement).href = `${SITE}/tools/rich-results-test${query}`;
  }
  try {
    const [result] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: () => document.documentElement.outerHTML });
    render(validateMarkup(String(result?.result ?? "")));
  } catch {
    app.innerHTML = `<p class="muted">Chrome doesn't let extensions read this page (browser pages and the Chrome Web Store are off limits). Open a regular website and try again.</p>`;
  }
}

void main();
