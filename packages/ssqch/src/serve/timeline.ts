// Where the time goes between a save and the browser hearing of it, for ssqch's own measurements
// (`bench/serve.ts`, and the dev-server design's stage 0 in the roadmap).
//
// With `SSQCH_SERVE_TIMELINE=<file>`, the server adds a line of JSON to the file for each rebuild:
// what changed, and when each step ended, in milliseconds since 1970 (`Date.now()`, so a script
// that saved the file can line them up with its own clock). The builder's process reports its
// own steps with the build. Nothing else changes: the terminal says what it always says, which
// the oracle checks, and without the variable nothing is timed.
import fs from "node:fs";

const file = process.env.SSQCH_SERVE_TIMELINE;

/** Whether rebuilds are being timed. */
export const timing = file !== undefined && file !== "";

/** What the builder's process says about a build it was asked for. */
export interface BuilderTimes {
	/** The server's message arrived. */
	received: number;
	/** The build began and ended. */
	started: number;
	finished: number;
	/** The build's own phases (`setup`, `data`, ..., `after`), in milliseconds each, as the summary's Time line has them. */
	phases: Array<[string, number]>;
	/** The summary was printed, just before the answer went back. */
	said: number;
}

/** One rebuild, as the server saw it. Every time is `Date.now()`. */
export interface Rebuild {
	kind: "rebuild" | "check";
	/** The first file named, as the terminal shows it. */
	file: string;
	/** The watcher heard the first change of this rebuild. */
	heard: number;
	/** The wait for more changes ended (the debounce). */
	debounced: number;
	/** The server asked the builder to build. */
	asked: number;
	/** The builder's own times, when it answered. */
	builder?: BuilderTimes;
	/** The answer arrived. */
	built: number;
	/** The wait for `serve.run`'s tools to write what the edit changed for them ended. */
	held: number;
	/** The output was compared with what browsers last saw, and they can hear of the change. */
	published: number;
	/** The `Serving ... at` line was printed. */
	said: number;
	ok: boolean;
	/** For a check: what it found (`checkRebuild` in `server.ts`). */
	check?: { verdict: string; differ: string[]; onlyClean: string[]; onlyServed: string[] };
}

/** Add one line to the timeline. Never fails the server: a measurement that can't be written is lost. */
export function record(entry: Rebuild | Record<string, unknown>): void {
	if (!timing) return;
	try { fs.appendFileSync(file!, JSON.stringify(entry) + "\n"); } catch { /* not the server's problem */ }
}
