// CLI URL-mode tests against local HTTP and HTTPS servers. Runs the CLI asynchronously so this
// process can keep serving, and checks the exit code. On Windows with Node 24.16, exiting with
// process.exit() after an HTTPS fetch aborted with a libuv assertion (#1). The certificate in
// test/fixtures/tls is a self-signed, test-only certificate for localhost. The
// URLs use the name "localhost" so the CLI does a DNS lookup, as it does for real sites.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import https from "node:https";

const pages = {
  "/clean": fs.readFileSync("test/fixtures/site/index.html", "utf8"),
  "/broken": fs.readFileSync("test/fixtures/site/blog/post.html", "utf8"),
};
const handler = (request, response) => {
  const body = pages[request.url];
  response.writeHead(body ? 200 : 404, { "content-type": "text/html" });
  response.end(body ?? "not found");
};
const tls = { key: fs.readFileSync("test/fixtures/tls/key.pem"), cert: fs.readFileSync("test/fixtures/tls/cert.pem") };
const servers = [http.createServer(handler), https.createServer(tls, handler)];
for (const server of servers) await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const [base, secureBase] = servers.map((server, index) => `${index ? "https" : "http"}://localhost:${server.address().port}`);

const run = (...args) =>
  new Promise((resolve) => {
    const env = { ...process.env, NODE_TLS_REJECT_UNAUTHORIZED: "0", NODE_NO_WARNINGS: "1" };
    const child = spawn(process.execPath, ["bin/schema-validate.js", ...args], { stdio: ["ignore", "pipe", "pipe"], env });
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

for (let attempt = 0; attempt < 3; attempt++) {
  const secure = await run(`${secureBase}/clean`);
  assert.equal(secure.status, 0, `HTTPS run ${attempt + 1}: ${secure.output}`);
}

const secureBroken = await run(`${secureBase}/broken`);
assert.equal(secureBroken.status, 1, secureBroken.output);

for (const server of servers) server.close();
console.log("cli url: 6 checks passed");
