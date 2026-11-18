// The command line's refusals, in clap's words as 0.7 printed them (crates/sitesquatch/src/cli.rs).
import { test } from "node:test";
import assert from "node:assert/strict";
import { parse, Printed, UsageError } from "./args.ts";
import { GRAMMAR } from "./cli.ts";

const refused = (line: string[]): string => {
	try {
		parse(GRAMMAR, line);
	} catch (e) {
		if (e instanceof UsageError) return e.message;
		throw e;
	}
	assert.fail(`${line.join(" ")} was accepted`);
};

test("an_empty_path_is_refused", () => {
	for (const line of [["build", "--root="], ["build", "-o", ""], ["build", "-o="], ["serve", "--ready-file="]]) {
		assert.match(refused(line), /^error: a value is required for '--(root <ROOT>|output <OUTPUT>|ready-file <FILE>)' but none was supplied/, line.join(" "));
	}
	assert.match(refused(["diff", "", "x"]), /^error: a value is required for '<BEFORE>' but none was supplied/);
	assert.match(refused(["footprint", ""]), /^error: a value is required for '\[DIR\]' but none was supplied/);
	// Not a path: an empty format is the build's to refuse, and an empty page path is `new`'s.
	assert.equal(parse(GRAMMAR, ["build", "--format="]).options.format, "");
	assert.deepEqual(parse(GRAMMAR, ["new", ""]).positionals, [""]);
});

test("the_usage_line_lists_the_options_given", () => {
	assert.match(refused(["build", "--root", "x", "-q", "--bogus"]), /\nUsage: ssqch build --root <ROOT> --quiet\n/);
	assert.match(refused(["build", "--bogus"]), /\nUsage: ssqch build \[OPTIONS\]\n/);
	// After a word that isn't a flag, or a flag given twice, it's the plain usage.
	assert.match(refused(["build", "--root", "x", "stray"]), /\nUsage: ssqch build \[OPTIONS\]\n/);
	assert.match(refused(["build", "-q", "-q"]), /^error: the argument '--quiet' cannot be used multiple times\n\nUsage: ssqch build \[OPTIONS\]\n/);
	assert.match(refused(["new", "--root", "x"]), /\nUsage: ssqch new --root <ROOT> <PATH>\n/);
});

test("help_answers_as_clap_did", () => {
	assert.throws(() => parse(GRAMMAR, ["help", "help"]), (e: unknown) => e instanceof Printed && e.text.startsWith("Print this message or the help of the given subcommand(s)\n\nUsage: ssqch help [COMMAND]...\n"));
	assert.match(refused(["help", "build", "extra"]), /^error: unrecognized subcommand 'extra'\n\nUsage: ssqch build \[OPTIONS\]\n/);
	assert.match(refused(["completions", "tcsh"]), /\n {2}tip: a similar value exists: 'zsh'\n\n/);
});
