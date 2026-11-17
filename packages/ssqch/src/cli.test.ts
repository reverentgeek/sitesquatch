// From crates/sitesquatch/src/cli.rs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { aliased } from "./cli.ts";

// Other generators' commands and flags that are aliases become ssqch's before the line is read.
test("aliases_rewrite_the_command_line", () => {
	const run = (line: string) => {
		const [args, used] = aliased(line.split(/\s+/).filter(Boolean), ["docs", "init"]);
		return [args.join(" "), used.map((r) => r.word).join(" ")];
	};
	const cases = [
		["dev", "serve", "dev"],
		["start --port 0", "serve --port 0", "start"],
		["--root site server", "--root site serve", "server"],
		["watch", "serve", "watch"],
		["preview --port 4173", "serve --built --port 4173", "preview"],
		["generate --env production", "build --env production", "generate"],
		["--watch", "serve", "--watch"],
		["build --serve --port 8081", "serve --port 8081", "--serve"],
		["--root site --watch", "serve --root site", "--watch"],
		["serve --watch", "serve", "--watch"],
		["build -d dist", "build --output dist", "-d"],
		["build --destination=dist --pathprefix /trail/", "build --output=dist --base /trail/", "--destination --pathprefix"],
		["-d dev build", "--output dev build", "-d"],
		["--root dev", "--root dev", ""],
		// A hint, not an alias, and another command's flag: left to be refused with the hint.
		["check", "check", ""],
		["new --watch posts/x.md", "new --watch posts/x.md", ""],
		// The commands that read their own arguments, and anything after `--`, as they are.
		["docs dev", "docs dev", ""],
		["docs -- --watch", "docs -- --watch", ""],
		["build -- -d", "build -- -d", ""],
	];
	for (const [line, want, used] of cases) assert.deepEqual(run(line), [want, used], line);
});
