// A test reporter for `progress.js`: one line for each test, `pass`, `fail` or `skip`, then its
// file (from this folder) and its name, with tabs between.
import path from "node:path";
import { fileURLToPath } from "node:url";

const ORACLE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export default async function* names(source) {
	for await (const event of source) {
		if (event.type !== "test:pass" && event.type !== "test:fail") continue;
		const { name, file, skip, todo, details } = event.data;
		// A file's own entry (the runner adds one for each file) isn't a test.
		if (details?.type === "suite" || !file || name === file) continue;
		const outcome = skip !== undefined || todo !== undefined ? "skip" : event.type === "test:pass" ? "pass" : "fail";
		yield `${outcome}\t${path.relative(ORACLE, file).split(path.sep).join("/")}\t${name}\n`;
	}
}
