// Builds the extension into extension/dist and zips it for the Chrome Web Store.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const root = path.dirname(new URL(import.meta.url).pathname);
const out = path.join(root, "dist");
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(path.join(out, "icons"), { recursive: true });
execFileSync("npx", ["esbuild@0.24.0", path.join(root, "src/popup.ts"), "--bundle", "--minify", "--format=iife", "--target=chrome110", `--outfile=${path.join(out, "popup.js")}`], { stdio: "inherit" });
for (const file of ["manifest.json", "popup.html", "popup.css"]) fs.copyFileSync(path.join(root, file), path.join(out, file));
for (const icon of fs.readdirSync(path.join(root, "icons"))) fs.copyFileSync(path.join(root, "icons", icon), path.join(out, "icons", icon));
const version = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8")).version;
const zip = path.join(root, `schema-validator-extension-${version}.zip`);
fs.rmSync(zip, { force: true });
execFileSync("zip", ["-qr", zip, "."], { cwd: out });
console.log(`built ${out} and ${path.basename(zip)}`);
