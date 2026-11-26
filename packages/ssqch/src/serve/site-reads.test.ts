import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { hearSiteReads, watchSiteReads } from "./site-reads.ts";

const nameAndLength = (fn: Function) => [fn.name, fn.length];

test("site_reads_are_heard_by_any_import_of_fs_and_change_nothing_else", async () => {
	const before = nameAndLength(fs.readFileSync);
	watchSiteReads();
	watchSiteReads(); // twice is once
	assert.deepEqual(nameAndLength(fs.readFileSync), before);
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ssqch-site-reads-"));
	const file = path.join(dir, "cedar.md");
	fs.writeFileSync(file, "Cedar");
	const heard: [string, boolean][] = [];
	hearSiteReads((read, listed) => heard.push([read, listed]));
	try {
		// A named import, after the wrap: rebound by syncBuiltinESMExports.
		const { readFileSync } = await import("node:fs");
		const promises = await import("node:fs/promises");
		assert.equal(readFileSync(file, "utf8"), "Cedar");
		assert.equal(await promises.readFile(pathToFileURL(file), "utf8"), "Cedar");
		assert.equal(fs.existsSync(path.join(dir, "gone.md")), false);
		assert.deepEqual(fs.readdirSync(dir), ["cedar.md"]);
		const fd = fs.openSync(file, "r");
		fs.readFileSync(fd); // a descriptor names nothing
		fs.closeSync(fd);
	} finally {
		hearSiteReads(undefined);
	}
	fs.readFileSync(file); // no listener, nothing heard
	assert.deepEqual(heard, [[file, false], [file, false], [path.join(dir, "gone.md"), false], [dir, true]]);
	fs.rmSync(dir, { recursive: true });
});
