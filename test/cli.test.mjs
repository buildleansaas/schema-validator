// CLI contract tests.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

const run = (...args) => spawnSync(process.execPath, ["bin/schema-validate.js", ...args], { encoding: "utf8" });

const clean = run("test/fixtures/site/index.html");
assert.equal(clean.status, 0, clean.stdout + clean.stderr);
assert.match(clean.stdout, /0 errors/);

const dir = run("test/fixtures/site");
assert.equal(dir.status, 1, "a directory with an error exits 1");
assert.match(dir.stdout, /LocalBussiness isn't a schema.org type/);
assert.match(dir.stdout, /Did you mean LocalBusiness\?/);

const never = run("test/fixtures/site", "--fail-on", "never");
assert.equal(never.status, 0);

const asJson = run("test/fixtures/site", "--json", "--fail-on", "never");
const parsed = JSON.parse(asJson.stdout);
assert.equal(parsed.length, 2);
assert.ok(parsed.every((item) => item.target && item.totals));

const quiet = run("test/fixtures/site", "--quiet");
assert.doesNotMatch(quiet.stdout, /index\.html/, "--quiet hides files without issues");

assert.equal(run().status, 1, "no arguments prints help and exits 1");
console.log("cli: 6 checks passed");
