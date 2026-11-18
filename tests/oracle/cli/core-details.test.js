// What a review of the Node build's core found it doing differently from 0.7: globs, TOML dates
// and numbers, `--output .`, `ssqch new`, slugs, and the command line's words. Not from a Rust
// test: written for the move to Node, from what 0.7.0's binary does.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { ssqch, tempDir, write, read, exists } from "../lib/ssqch.js";

const unix = { skip: process.platform === "win32" && "a backslash in a glob is a folder separator on Windows, and links need privileges there" };

test("build_into_the_project_root_leaves_the_source_alone", () => {
	const dir = tempDir("output-dot");
	write(dir, { "src/index.html": "<p>{{ 1 + 1 }}</p>" });
	const r = ssqch(["build", "-o", "."], { cwd: dir });
	assert.ok(r.ok, r.log);
	assert.ok(r.log.includes("Nothing sighted: no file in . matches templateFormats"), r.log);
	assert.equal(read(dir, "src/index.html"), "<p>{{ 1 + 1 }}</p>");
});

test("an_output_folder_outside_the_root_given_from_it", () => {
	const dir = tempDir("output-outside");
	write(dir, { "site/src/a.html": "hi" });
	const r = ssqch(["build", "-o", "../out"], { cwd: path.join(dir, "site") });
	// 0.7 refused it, by mistake: its check for a permalink that leaves the output folder counted
	// the `..` in the folder's own name. An absolute path worked.
	assert.ok(r.ok, r.log);
	assert.equal(read(dir, "out/src/a/index.html"), "hi");
});

test("diff_only_reads_globs_as_globset_did", () => {
	const dir = tempDir("diff-only-globs");
	for (const [side, n] of [["a", "1"], ["b", "2"]]) write(dir, { [`${side}/br/{y}.txt`]: n, [`${side}/br/[x.txt`]: n, [`${side}/x/a.txt`]: n });
	const changed = (glob) => {
		const r = ssqch(["diff", "a", "b", "--exact", "--format", "json", "--only", glob], { cwd: dir });
		assert.ok(r.code === 0 || r.code === 1, r.log);
		return JSON.parse(r.stdout).changed.map((c) => c.path).sort();
	};
	// `**/` alone is every path.
	assert.deepEqual(changed("**/"), ["br/[x.txt", "br/{y}.txt", "x/a.txt"]);
	assert.deepEqual(changed("x/**"), ["x/a.txt"]);
	const r = ssqch(["diff", "a", "b", "--only", "[z-a]"], { cwd: dir });
	assert.ok(r.code === 2 && r.log.includes("error parsing glob '[z-a]': invalid range; 'z' > 'a'"), r.log);
});

test("diff_only_escapes_with_a_backslash", unix, () => {
	const dir = tempDir("diff-only-escapes");
	for (const [side, n] of [["a", "1"], ["b", "2"]]) write(dir, { [`${side}/br/{y}.txt`]: n, [`${side}/br/[x.txt`]: n, [`${side}/x/a.txt`]: n });
	const changed = (glob) => JSON.parse(ssqch(["diff", "a", "b", "--exact", "--format", "json", "--only", glob], { cwd: dir }).stdout).changed.map((c) => c.path);
	assert.deepEqual(changed("br/\\{y\\}.txt"), ["br/{y}.txt"]);
	assert.deepEqual(changed("br/\\[x.txt"), ["br/[x.txt"]);
	assert.deepEqual(changed("x\\/*"), ["x/a.txt"]);
});

test("toml_dates_and_numbers_are_checked_as_0_7_checked_them", () => {
	const dir = tempDir("toml-dates");
	write(dir, { "ssqch.config.js": "export default { dirs: { input: \"src\", output: \"dist\" } };\n" });
	const page = (frontMatter) => {
		write(dir, { "src/index.html": `+++\n${frontMatter}\n+++\n{{ d }}` });
		return ssqch(["build", "-q"], { cwd: dir });
	};
	let r = page("d = 2023-02-30");
	assert.ok(!r.ok && r.log.includes("invalid TOML front matter") && r.log.includes("invalid date, expected day between 01 and 28"), r.log);
	r = page("d = 1979-05-27T07:32:60Z");
	assert.ok(r.ok, r.log);
	assert.equal(read(dir, "dist/index.html"), "1979-05-27T07:32:60Z");
	r = page("d = 1979-05-27 07:32");
	assert.ok(r.ok, r.log);
	assert.equal(read(dir, "dist/index.html"), "1979-05-27T07:32");
	// A page's `date` is a date: a JavaScript one has no 60th second, so it's the second before
	// (CHANGELOG.md, 0.8.0). 0.7's dates had leap seconds.
	write(dir, { "src/index.html": "+++\ndate = 1979-05-27T07:32:60Z\n+++\n{{ page.date }}" });
	r = ssqch(["build", "-q"], { cwd: dir });
	assert.ok(r.ok, r.log);
	assert.equal(read(dir, "dist/index.html"), "1979-05-27T07:32:59.000Z");
	r = page("d = 9223372036854775808");
	assert.ok(!r.ok && r.log.includes("invalid TOML front matter"), r.log);
	r = page("d = 1e400");
	assert.ok(!r.ok && r.log.includes("floating-point number overflowed"), r.log);
});

test("a_proto_key_is_only_a_key", () => {
	const dir = tempDir("proto-key");
	write(dir, {
		"ssqch.config.js": "export default { dirs: { input: \"src\", output: \"dist\" } };\n",
		"src/index.html": "+++\n[extra]\n__proto__ = { polluted = true }\n+++\n[{{ extra.polluted }}]{{ extra | tojson }}",
	});
	const r = ssqch(["build", "-q"], { cwd: dir });
	assert.ok(r.ok, r.log);
	assert.equal(read(dir, "dist/index.html"), "[]{\"__proto__\": {\"polluted\": true}}");
});

test("new_reads_a_blueprint_as_0_7_did", () => {
	const dir = tempDir("new-blueprints");
	write(dir, {
		"_blueprints/posts.md": Buffer.from("---\ntitle:\n---\ncaf\xe9\n", "latin1"),
		"_blueprints/notes.md": "---json\n{\"title\": \"\", \"2024\": \"year\", \"weight\": 1.0, \"big\": 12345678901234567890, \"exp\": 1e5}\n---\n",
	});
	let r = ssqch(["new", "posts/x.md"], { cwd: dir });
	assert.ok(!r.ok && r.log.includes("_blueprints") && r.log.includes("posts.md: stream did not contain valid UTF-8"), r.log);
	assert.ok(!exists(dir, "posts/x.md"));
	r = ssqch(["new", "notes/n1.md", "--set", "neg=-0", "--set", "obj={\"z\":1,\"1\":3}"], { cwd: dir });
	assert.ok(r.ok, r.log);
	assert.equal(read(dir, "notes/n1.md"), "---json\n{\n  \"title\": \"N1\",\n  \"2024\": \"year\",\n  \"weight\": 1.0,\n  \"big\": 12345678901234567890,\n  \"exp\": 100000.0,\n  \"neg\": -0.0,\n  \"obj\": {\n    \"z\": 1,\n    \"1\": 3\n  }\n}\n---\n");
	// The slug lowercases each letter on its own: no final sigma.
	write(dir, { "_blueprints/posts.md": "---\ntitle:\n---\n" });
	r = ssqch(["new", "posts", "--title", "ΟΔΟΣ"], { cwd: dir });
	assert.ok(r.ok && exists(dir, "posts/οδοσ.md"), r.log);
});

test("new_passes_over_a_link_to_nothing", unix, () => {
	const dir = tempDir("new-dangling");
	write(dir, { "_blueprints/default.md": "---\ntitle:\n---\nDefault\n" });
	fs.symlinkSync("nowhere", path.join(dir, "_blueprints/posts.md"));
	const r = ssqch(["new", "posts/x.md"], { cwd: dir });
	assert.ok(r.ok && r.log.includes("from _blueprints/default.md"), r.log);
	assert.ok(read(dir, "posts/x.md").includes("Default"));
});

test("slugify_lowercases_each_letter_on_its_own", () => {
	const dir = tempDir("slugify-sigma");
	write(dir, { "ssqch.config.js": "export default { dirs: { input: \"src\", output: \"dist\" } };\n", "src/index.html": "{{ \"ΟΔΟΣ ΚΑΙ ΣΟΦΙΑΣ\" | slugify }}" });
	const r = ssqch(["build", "-q"], { cwd: dir });
	assert.ok(r.ok, r.log);
	assert.equal(read(dir, "dist/index.html"), "οδοσ-και-σοφιασ");
});

test("the_command_line_reads_as_clap_did", () => {
	const dir = tempDir("usage-lines");
	const usage = (args) => {
		const r = ssqch(args, { cwd: dir });
		assert.equal(r.code, 2, r.log);
		// clap names the program as it was run: `ssqch.exe` on Windows, where 0.7 is that file.
		return r.stderr.replaceAll("Usage: ssqch.exe ", "Usage: ssqch ");
	};
	assert.ok(usage(["build", "--verbos"]).includes("tip: a similar argument exists: '--verbose'\n\nUsage: ssqch build --verbose\n"));
	assert.ok(usage(["inspect", "--formt", "json", "x"]).includes("\n\nUsage: ssqch inspect --format <FORMAT> <PAGE>\n"));
	assert.ok(usage(["--root", "x", "--verbos", "build"]).includes("\n\nUsage: ssqch --root <ROOT> --verbose\n"));
	assert.ok(usage(["--quiet=1"]).includes("\n\nUsage: ssqch --quiet\n"));
	assert.ok(usage(["--", "build"]).includes("tip: subcommand 'build' exists; to use it, remove the '--' before it"));
	assert.ok(usage(["-q="]).startsWith("error: unexpected argument '-=' found"));
	assert.ok(usage(["build", "-xyz"]).startsWith("error: unexpected argument '-x' found"));
	assert.ok(usage(["new", "post", "--", "--x"]).includes("\n\nUsage: ssqch new [OPTIONS] <PATH>\n"));
	assert.ok(usage(["build", "--root", "--"]).startsWith("error: a value is required for '--root <ROOT>' but none was supplied"));
	// Other generators' flags are aliases for `completions` too.
	const r = ssqch(["completions", "zsh", "-d", "x"], { cwd: dir });
	assert.ok(r.ok && r.stdout.startsWith("#compdef ssqch"), r.log);
});

test("paths_in_messages_are_as_given", () => {
	const dir = tempDir("paths-as-given");
	let r = ssqch(["--root", "nope", "build"], { cwd: dir });
	assert.ok(!r.ok && r.log.includes(`input directory nope${path.sep}. does not exist`), r.log);
	r = ssqch(["init", "./"], { cwd: dir });
	assert.ok(r.ok && r.log.includes("Camp is set up. Next: ssqch serve,"), r.log);
	write(dir, { f: "" });
	r = ssqch(["init", "f"], { cwd: dir });
	assert.ok(!r.ok && r.log.includes("creating f: "), r.log);
});

test("sitesquatch_toml_budgets_are_checked", () => {
	const dir = tempDir("toml-budgets");
	write(dir, { "sitesquatch.toml": "input = \"src\"\n[budgets]\npages = [10, 20]\n", "src/index.html": "hi" });
	const r = ssqch(["build", "-q"], { cwd: dir });
	assert.ok(!r.ok && r.log.includes(`invalid .${path.sep}sitesquatch.toml: budgets.pages: "[10, 20]" isn't a size`), r.log);
});

test("sighting_with_a_list_that_isnt_one", () => {
	const dir = tempDir("sighting-null");
	write(dir, { ".cache/ssqch/output-files.json": "null" });
	const r = ssqch(["sighting"], { cwd: dir });
	assert.ok(r.ok && r.log.includes("No confirmed sitings here yet."), r.log);
});

test("capabilities_lists_completions_after_footprint", () => {
	const r = ssqch(["capabilities", "--format", "json"]);
	const commands = JSON.parse(r.stdout).commands;
	assert.equal(commands.indexOf("completions"), commands.indexOf("footprint") + 1);
});

test("a_walk_names_what_it_found_as_given", unix, () => {
	const dir = tempDir("walk-errors");
	fs.mkdirSync(path.join(dir, "broken/a"), { recursive: true });
	fs.symlinkSync("nowhere", path.join(dir, "broken/dead"));
	fs.mkdirSync(path.join(dir, "loop/a/b"), { recursive: true });
	fs.symlinkSync("../../a", path.join(dir, "loop/a/b/up"));
	let r = ssqch(["footprint", "broken/"], { cwd: dir });
	assert.ok(!r.ok && r.log.includes("error: reading broken/: IO error for operation on broken/dead: No such file or directory (os error 2)"), r.log);
	r = ssqch(["footprint", "loop"], { cwd: dir });
	assert.ok(!r.ok && r.log.includes("File system loop found: loop/a/b/up points to an ancestor loop/a"), r.log);
});

test("inspect_prints_numbers_as_0_7_did", () => {
	const dir = tempDir("inspect-numbers");
	write(dir, { "ssqch.config.js": "export default { dirs: { input: \"src\" }, data: { nums: { big: 1e16, whole: 1e15, small: 1e-6 }, when: new Date(NaN) } };\n", "src/index.html": "hi" });
	let r = ssqch(["inspect", "/", "--field", "nums", "--format", "json"], { cwd: dir });
	assert.ok(r.ok, r.log);
	assert.ok(r.stdout.includes("\"big\": 1e+16,\n") && r.stdout.includes("\"whole\": 1000000000000000,\n") && r.stdout.includes("\"small\": 1e-6\n"), r.stdout);
	// A date that isn't one is `null`, as JSON.stringify writes it (CHANGELOG.md, 0.8.0); 0.7
	// showed the start of 1970.
	r = ssqch(["inspect", "/", "--field", "when", "--format", "json"], { cwd: dir });
	assert.ok(r.ok, r.log);
	assert.equal(JSON.parse(r.stdout).field.value, null);
});
