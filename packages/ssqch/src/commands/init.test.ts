import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "../config.ts";
import { schemaTypes } from "../schema.ts";
import { DOCS_SCHEMAS, starterFiles } from "./init.ts";

// The starters' JavaScript type-checks with the `jsconfig.json` init writes, under TypeScript's
// strict mode, the default from TypeScript 7: the site starter's config failed it (`value`
// had no type, Pack Mule), and the docs starter's `docs.js` failed even without it. What's left is
// `node:fs` in the docs starter's config, whose types are `@types/node`'s: editors fetch them,
// and a starter doesn't install packages.
test("the starters type-check with the jsconfig.json init writes, strict", () => {
	const tsc = fileURLToPath(new URL("../../node_modules/typescript/bin/tsc", import.meta.url));
	for (const starter of ["site", "docs"] as const) {
		for (const engine of ["jinja", "njk", "liquid", "edge", "hbs", "ejs"] as const) {
			const dir = fs.mkdtempSync(path.join(os.tmpdir(), `ssqch-init-tsc-${starter}-`));
			try {
				for (const [rel, contents] of starterFiles(starter, engine)) {
					fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
					fs.writeFileSync(path.join(dir, rel), contents);
				}
				const run = spawnSync(process.execPath, [tsc, "-p", "jsconfig.json", "--strict", "--pretty", "false"], { cwd: dir, encoding: "utf8" });
				const errors = run.stdout.split("\n").filter((line) => line.includes("error TS") && !/'node:fs'/.test(line));
				assert.deepEqual(errors, [], `${starter} starter, ${engine}`);
			} finally {
				fs.rmSync(dir, { recursive: true, force: true });
			}
		}
	}
});

// The docs starter's `ssqch.d.ts` has its schemas from the start, so a new site's first build
// doesn't say its types are stale: the copy in init.ts is the starter's config, as `ssqch types`
// writes it.
test("the docs starter's types have its config's schemas", async () => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ssqch-init-docs-"));
	// Loading the config moves the process into the site's folder, which Windows won't remove.
	const cwd = process.cwd();
	try {
		for (const [rel, contents] of starterFiles("docs", "jinja")) {
			fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
			fs.writeFileSync(path.join(dir, rel), contents);
		}
		const config = await loadConfig({ root: dir, env: "development", quiet: true });
		assert.deepEqual(schemaTypes(config), DOCS_SCHEMAS);
		assert.ok(fs.readFileSync(path.join(dir, "ssqch.d.ts"), "utf8").includes(`docs: ${DOCS_SCHEMAS[0][1]};`));
	} finally {
		process.chdir(cwd);
		fs.rmSync(dir, { recursive: true, force: true });
	}
});
