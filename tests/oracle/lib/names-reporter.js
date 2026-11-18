// A test reporter for `progress.js`: one line for each test, `pass`, `fail` or `skip`, then its
// file (from this folder) and its name, with tabs between. A failure adds how long it took and
// its error, as JSON, so CI's log has why it failed the first time (a rerun may pass).
import path from "node:path";
import { fileURLToPath } from "node:url";

const ORACLE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export default async function* names(source) {
	for await (const event of source) {
		if (event.type !== "test:pass" && event.type !== "test:fail") continue;
		const { name, file, skip, todo, details } = event.data;
		if (details?.type === "suite" || !file) continue;
		const relative = path.relative(ORACLE, file).split(path.sep).join("/");
		const error = details?.error;
		const failure = () => JSON.stringify({ ms: Math.round(details?.duration_ms ?? 0), why: String(error?.cause?.message ?? error?.cause ?? error?.message ?? error ?? "") });
		// A file's own entry (the runner adds one for each file) isn't a test. Node names it with
		// the path as found (relative on 22.18), and a failed one says why the file failed.
		if (name === file || path.resolve(ORACLE, name) === file) {
			// Failing because its tests did is said by those tests.
			if (event.type === "test:fail" && error?.failureType !== "subtestsFailed") yield `file\t${relative}\t${failure()}\n`;
			continue;
		}
		const outcome = skip !== undefined || todo !== undefined ? "skip" : event.type === "test:pass" ? "pass" : "fail";
		const where = `${outcome}\t${relative}\t${name}`;
		yield outcome === "fail" ? `${where}\t${failure()}\n` : `${where}\n`;
	}
}
