import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildsWithSsqch } from "./baseline.ts";

// A site that builds with ssqch gets its own Next line, not a move's (the new docs site's rerun).
test("a command that builds with ssqch is told apart from another generator's", () => {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "ssqch-baseline-"));
	fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ scripts: { build: "ssqch build --quiet", old: "eleventy" } }));
	for (const command of ["ssqch build", "npx ssqch build", "node bin/ssqch.ts build", "node \"C:\\tools\\ssqch.js\" build", "rm -rf dist && ssqch build", "npm run build", "pnpm build"]) {
		assert.ok(buildsWithSsqch(command, root), command);
	}
	for (const command of ["npx @11ty/eleventy", "npm run old", "npm run missing", "ssqch-legacy build", "myssqch build", "ssqch serve"]) {
		assert.ok(!buildsWithSsqch(command, root), command);
	}
});
