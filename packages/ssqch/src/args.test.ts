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
	// clap counted the option it suggested as given, and listed the options before the command too.
	assert.match(refused(["build", "-q", "--verbos"]), /tip: a similar argument exists: '--verbose'\n\nUsage: ssqch build --quiet --verbose\n/);
	assert.match(refused(["inspect", "--formt", "json", "x"]), /\nUsage: ssqch inspect --format <FORMAT> <PAGE>\n/);
	assert.match(refused(["--root", "x", "--verbos", "build"]), /\nUsage: ssqch --root <ROOT> --verbose\n/);
	assert.match(refused(["--quiet=1"]), /\nUsage: ssqch --quiet\n/);
	// An argument too many is the whole usage line, after `--` too.
	assert.match(refused(["new", "post", "--", "--x"]), /^error: unexpected argument '--x' found\n\nUsage: ssqch new \[OPTIONS\] <PATH>\n/);
});

test("words_after_a_double_dash_and_short_flags_as_clap_read_them", () => {
	assert.match(refused(["--", "build"]), /^error: unexpected argument 'build' found\n\n {2}tip: subcommand 'build' exists; to use it, remove the '--' before it\n/);
	assert.match(refused(["--", "buil"]), /^error: unrecognized subcommand 'buil'\n\n {2}tip: a similar subcommand exists: 'build'\n/);
	assert.match(refused(["--", "-q"]), /^error: unrecognized subcommand '-q'\n/);
	assert.match(refused(["build", "--root", "--"]), /^error: a value is required for '--root <ROOT>' but none was supplied/);
	// The letter that isn't known, alone.
	assert.match(refused(["-="]), /^error: unexpected argument '-=' found/);
	assert.match(refused(["-q="]), /^error: unexpected argument '-=' found/);
	assert.match(refused(["-xyz"]), /^error: unexpected argument '-x' found/);
	assert.match(refused(["new", "-x=1", "a"]), /tip: to pass '-x' as a value, use '-- -x'/);
});

test("help_answers_as_clap_did", () => {
	assert.throws(() => parse(GRAMMAR, ["help", "help"]), (e: unknown) => e instanceof Printed && e.text.startsWith("Print this message or the help of the given subcommand(s)\n\nUsage: ssqch help [COMMAND]...\n"));
	assert.match(refused(["help", "build", "extra"]), /^error: unrecognized subcommand 'extra'\n\nUsage: ssqch build \[OPTIONS\]\n/);
	assert.match(refused(["completions", "tcsh"]), /\n {2}tip: a similar value exists: 'zsh'\n\n/);
});

test("globals_that_do_nothing_are_refused_by_the_newer_commands", () => {
	// baseline writes where --to says; --output was accepted and did nothing.
	assert.match(refused(["baseline", "true", "--output", "x"]), /^error: unexpected argument '--output' found\n\n  tip: '--output' does nothing for ssqch baseline: use '--to'\n/);
	assert.match(refused(["scout", "--base", "/x/"]), /tip: '--base' does nothing for ssqch scout\n/);
	assert.equal(parse(GRAMMAR, ["baseline", "true", "--root", "site", "-q"]).options.root, "site");
	// 0.7's commands still accept every global.
	assert.equal(parse(GRAMMAR, ["diff", "a", "b", "--root", "x"]).options.root, "x");
});
