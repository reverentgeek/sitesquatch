import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadConfig } from "../config.ts";
import { schemaTypes } from "../schema.ts";
import { DOCS_SCHEMAS, starterFiles } from "./init.ts";

// The docs starter's `ssqch.d.ts` has its schemas from the start, so a new site's first build
// doesn't say its types are stale: the copy in init.ts is the starter's config, as `ssqch types`
// writes it.
test("the docs starter's types have its config's schemas", async () => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ssqch-init-docs-"));
	try {
		for (const [rel, contents] of starterFiles("docs", "jinja")) {
			fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
			fs.writeFileSync(path.join(dir, rel), contents);
		}
		const config = await loadConfig({ root: dir, env: "development", quiet: true });
		assert.deepEqual(schemaTypes(config), DOCS_SCHEMAS);
		assert.ok(fs.readFileSync(path.join(dir, "ssqch.d.ts"), "utf8").includes(`docs: ${DOCS_SCHEMAS[0][1]};`));
	} finally {
		fs.rmSync(dir, { recursive: true, force: true });
	}
});
