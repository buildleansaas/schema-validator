// CLI URL-mode tests against a local HTTP server. Runs the CLI asynchronously so this
// process can keep serving, and checks the exit code (Windows used to abort here, see #1).
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";

const pages = {
  "/clean": fs.readFileSync("test/fixtures/site/index.html", "utf8"),
  "/broken": fs.readFileSync("test/fixtures/site/blog/post.html", "utf8"),
};
const server = http.createServer((request, response) => {
  const body = pages[request.url];
  response.writeHead(body ? 200 : 404, { "content-type": "text/html" });
  response.end(body ?? "not found");
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${server.address().port}`;

const run = (...args) =>
  new Promise((resolve) => {
    const child = spawn(process.execPath, ["bin/schema-validate.js", ...args], { stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    child.stdout.on("data", (chunk) => (output += chunk));
    child.stderr.on("data", (chunk) => (output += chunk));
    child.on("close", (status, signal) => resolve({ status, signal, output }));
  });

const clean = await run(`${base}/clean`);
assert.equal(clean.status, 0, clean.output);
assert.match(clean.output, /0 errors/);

const broken = await run(`${base}/broken`);
assert.equal(broken.status, 1, broken.output);

const never = await run(`${base}/broken`, "--fail-on", "never");
assert.equal(never.status, 0, never.output);

const missing = await run(`${base}/missing`);
assert.equal(missing.status, 1, missing.output);
assert.match(missing.output, /HTTP 404/);

server.close();
console.log("cli url: 4 checks passed");
