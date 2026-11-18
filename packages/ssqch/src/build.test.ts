// From crates/sitesquatch/src/build.rs.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { asTextForTest as asText, commandLine, edgeCodeMentionsForTest as edgeCodeMentions, sameContentsForTest as sameContents } from "./build.ts";
import { BuildError } from "./diagnostics.ts";
import { BUILTIN_FILTERS, builtinFilters } from "./filters.ts";
import { markdownEngine } from "./engines/markdown.ts";
import { defaultMarkdownOptions } from "./markdown-options.ts";

test("the_filter_list_names_every_builtin_filter", () => {
	const have = [...builtinFilters(markdownEngine(defaultMarkdownOptions()), { base: "" } as any).keys()].sort();
	assert.deepEqual(have, BUILTIN_FILTERS.map(([name]) => name).sort());
});

test("collections_in_prose_is_not_code", () => {
	const code = [
		"{{ collections.posts.length }}",
		"{{{ collections.all[0].templateContent }}}",
		"<ul>\n  @each(post in collections.posts)\n  <li>{{ post.url }}</li>\n  @end\n</ul>",
		"{{ adjacentPosts(\n  collections.posts, page.url) }}",
	];
	for (const body of code) assert.ok(edgeCodeMentions(body, "collections"), body);
	const prose = [
		"I have mugs, hats, toys and other collections.",
		"Collections in ssqch are {{ \"great\" }}, and so are collections.",
		"{{-- collections are rendered later --}}",
		"Use `collections.posts` in a template.",
	];
	for (const body of prose) assert.ok(!edgeCodeMentions(body, "collections"), body);
});

test("an_engine_that_answers_with_something_other_than_text_is_one_clear_error", async () => {
	// What nunjucks gave for an include that didn't parse: `null`, then a crash in what read it.
	for (const [out, said] of [[null, "null"], [undefined, "undefined"], [5, "number"]] as const) {
		assert.throws(() => asText(out, "njk", "index.njk"), (e: unknown) => e instanceof BuildError && e.message.includes(`internal error while processing index.njk: the \`njk\` engine gave ${said} instead of text`));
	}
	await assert.rejects(asText(Promise.resolve(null), "liquid", "_includes/base.liquid"), (e: unknown) => e instanceof BuildError && e.message.includes("the `liquid` engine gave null instead of text"));
	assert.equal(await asText(Promise.resolve("<p>Pine Cone Crunch</p>"), "edge", "index.edge"), "<p>Pine Cone Crunch</p>");
});

test("a_sites_commands_get_the_environment_ssqch_was_given", () => {
	const had = process.env.UV_THREADPOOL_SIZE;
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ssqch-command-"));
	try {
		fs.mkdirSync(path.join(dir, "node_modules", ".bin"), { recursive: true });
		const run = (command: string) => {
			const { file, args, options } = commandLine(command, dir, { SSQCH_SERVING: "true" });
			// cmd.exe's `echo` keeps the space before `&&`, and ends lines with `\r\n`.
			return spawnSync(file, args, { ...options, encoding: "utf8" }).stdout.trim().split(/\r?\n/).map((line) => line.trimEnd()).join("\n");
		};
		const show = process.platform === "win32" ? "echo pool=%UV_THREADPOOL_SIZE% serving=%SSQCH_SERVING%" : "echo pool=${UV_THREADPOOL_SIZE:-%UV_THREADPOOL_SIZE%} serving=$SSQCH_SERVING";
		// The pool ssqch sized for itself (bin/ssqch.ts) isn't the command's.
		process.env.UV_THREADPOOL_SIZE = String(os.availableParallelism() + 4);
		assert.equal(run(show), "pool=%UV_THREADPOOL_SIZE% serving=true");
		// One the person running ssqch set is.
		process.env.UV_THREADPOOL_SIZE = "7";
		assert.equal(run(show), "pool=7 serving=true");
		// The project's tools come first.
		const { options } = commandLine("x", dir, {});
		assert.equal(options.env.PATH!.split(path.delimiter)[0], path.join(dir, "node_modules", ".bin"));
		// Quotes and the shell's own words, as written.
		assert.equal(run("echo \"Pine Cone Crunch\" && echo trail"), process.platform === "win32" ? "\"Pine Cone Crunch\"\ntrail" : "Pine Cone Crunch\ntrail");
	} finally {
		if (had === undefined) delete process.env.UV_THREADPOOL_SIZE;
		else process.env.UV_THREADPOOL_SIZE = had;
		fs.rmSync(dir, { recursive: true, force: true });
	}
});

test("a_page_rewritten_with_its_size_and_modification_time_kept_is_read_again", (t) => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ssqch-same-"));
	try {
		const file = path.join(dir, "index.html");
		const page = "<p>Pine Cone Crunch</p>";
		fs.writeFileSync(file, page);
		// Whole seconds, so the time put back is the same to the nanosecond.
		const when = 1_700_000_000;
		fs.utimesSync(file, when, when);
		// The build read it long after it was written, so it trusts the file's times next time.
		t.mock.timers.enable({ apis: ["Date"], now: Date.now() + 10_000 });
		assert.equal(sameContents(file, page), true);
		assert.equal(sameContents(file, page), true);
		// What `cp -p` and `touch -r` do: other contents of the same size, and the old time.
		fs.writeFileSync(file, "<p>Pine Cone Crumbs</p>");
		fs.utimesSync(file, when, when);
		assert.equal(fs.statSync(file).mtimeMs, when * 1000);
		assert.equal(sameContents(file, page), false);
		assert.equal(sameContents(file, "<p>Pine Cone Crumbs</p>"), true);
	} finally {
		fs.rmSync(dir, { recursive: true, force: true });
	}
});
