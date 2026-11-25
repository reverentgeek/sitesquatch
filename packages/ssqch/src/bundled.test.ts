import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { bundledPath } from "./bundled.ts";

// Every example site comes with the package (`bundled/examples/<name>/`), so an agent in a site's
// folder can copy one the docs link to: Pack Mule found `islands` and `searchable-directory` only
// on GitHub. From the source, they're read where they are in the repository.
test("every example site is bundled, by its folder's name", () => {
	const examples = fileURLToPath(new URL("../../../examples/sites/", import.meta.url));
	const names = fs.readdirSync(examples, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);
	assert.ok(names.includes("islands") && names.includes("searchable-directory") && names.includes("multilingual"), names.join(", "));
	for (const name of names) assert.ok(fs.existsSync(path.join(bundledPath(`examples/${name}`), "ssqch.config.js")), name);
});
