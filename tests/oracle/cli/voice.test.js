// From crates/ssqch/tests/cli.rs.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { ssqch, tempDir, write, read, exists, isFile } from "../lib/ssqch.js";

// The lines with a Sasquatch in them still say what happened.
test("the_ranger_reports_what_happened", () => {
	const dir = tempDir("voice");
	const d = dir;
	const w = (file, text) => write(dir, { [file]: text });
	w("ssqch.config.js", "export default { dirs: { input: \"src\", output: \"dist\" }, templateFormats: [\"edge\", \"md\"], markdownEngine: \"edge\" };\n");

	// Nothing to build.
	fs.mkdirSync(path.join(dir, "src"), { recursive: true });
	w("src/notes.txt", "not a page");
	let r = ssqch(["build", "--root", d]);
	assert.ok(r.ok && r.log.includes("Nothing sighted: no file in src matches templateFormats (edge, md).\n"), r.log);
	// A site whose input folder is the project root.
	const rootSite = tempDir("voice-root");
	fs.writeFileSync(path.join(rootSite, "notes.txt"), "not a page");
	r = ssqch(["build", "--root", rootSite]);
	assert.ok(r.ok && r.log.includes("Nothing sighted: no file in . matches templateFormats (jinja, md, html).\n"), r.log);

	// Layouts that lead back to each other: the loop is named.
	w("src/_includes/base.edge", "---\nlayout: wrap.edge\n---\n{{{ content }}}");
	w("src/_includes/wrap.edge", "---\nlayout: base.edge\n---\n{{{ content }}}");
	w("src/index.md", "---\nlayout: base.edge\n---\nHi\n");
	r = ssqch(["build", "--root", d]);
	assert.ok(!r.ok && r.log.includes("in index.md: we've passed this tree before. Layout loop: base.edge -> wrap.edge -> base.edge"), r.log);
	r = ssqch(["build", "--format", "json", "--root", d]);
	let report;
	try { report = JSON.parse(r.stdout); } catch (e) { throw new Error(`${e.message}: ${r.stdout}`); }
	assert.deepEqual([report.errors[0].code, report.errors[0].file], ["template", "src/index.md"], r.stdout);

	// A layout that isn't there, with the one it probably meant.
	w("src/_includes/wrap.edge", "{{{ content }}}");
	w("src/index.md", "---\nlayout: bse\n---\nHi\n");
	r = ssqch(["build", "--root", d]);
	assert.ok(!r.ok && r.log.includes("in index.md: layout `bse` not found: no sightings in ") && r.log.includes("_includes (did you mean `base`?)"), r.log);
	w("src/index.md", "---\nlayout: nothing-like-it.edge\n---\nHi\n");
	r = ssqch(["build", "--root", d]);
	assert.ok(!r.ok && r.log.includes("layout `nothing-like-it.edge` not found: no sightings in ") && !r.log.includes("did you mean"), r.log);

	// An include that isn't there, a config key and a plugin option that are nearly right.
	w("src/_includes/partials/nav.edge", "<nav></nav>");
	w("src/index.md", "---\nlayout: wrap.edge\n---\n@include('partials/navv')\n");
	r = ssqch(["build", "--root", d]);
	assert.ok(!r.ok && r.log.includes("index.md:4: @include('partials/navv'): template not found: ") && r.log.includes("(did you mean `partials/nav`?)"), r.log);
	// The line it's about, numbered as the file is, with carets under what the message quotes.
	assert.ok(r.log.includes("\n\n  --> src/index.md:4\n   2 | layout: wrap.edge\n   3 | ---\n   4 | @include('partials/navv')\n     |           ^^^^^^^^^^^^^\n"), r.log);
	// Colour is for terminals, and this is a pipe.
	assert.ok(r.log.startsWith("error: ") && !r.log.includes("\u001b"), JSON.stringify(r.log));
	const config = read(dir, "ssqch.config.js");
	for (const [bad, expected] of [
		["export default { templateFormat: [\"md\"] };", "ssqch.config.js: \"templateFormat\" isn't a config option (did you mean \"templateFormats\"?) (options: dirs, "],
		["export default { output: \"dist\" };", "ssqch.config.js: \"output\" isn't a config option (it goes in dirs: { output: \"...\" }) (options: dirs, "],
		["export default { dirs: { inptu: \"src\" } };", "ssqch.config.js: dirs.inptu isn't supported (did you mean \"input\"?) (use input, "],
		["export default { markdown: { footnote: true } };", "markdown.footnote isn't an option (did you mean `footnotes`?) (options: "],
		["import { imagePlugin } from \"ssqch/image\";\nexport default { plugins: [imagePlugin({ widhts: [300] })] };", "unknown option \"widhts\" (did you mean \"widths\"?) (options: formats, widths, "],
		["export default { pineCones: 3 };", "ssqch.config.js: \"pineCones\" isn't a config option (options: dirs, "],
	]) {
		w("ssqch.config.js", bad);
		r = ssqch(["build", "--root", d]);
		assert.ok(!r.ok && r.log.includes(expected), `${bad}: ${r.log}`);
	}
	w("ssqch.config.js", config);

	// Two pages for one URL.
	w("src/index.md", "---\nlayout: wrap.edge\n---\nHi\n");
	w("src/about.md", "About\n");
	w("src/about/index.md", "About too\n");
	r = ssqch(["build", "--root", d]);
	assert.ok(!r.ok && r.log.includes("output conflicts (two sets of tracks lead to the same place):\n  - about") && r.log.includes(" both write to "), r.log);
	r = ssqch(["build", "--format", "json", "--root", d]);
	assert.ok(r.stdout.includes("\"code\": \"conflict\""), r.stdout);
	fs.rmSync(path.join(dir, "src/about/index.md"));

	// Drafts are counted in production, and built in development.
	w("src/wip.md", "---\ndraft: true\n---\nNot yet\n");
	w("src/later.md", "---\ndraft: true\n---\nNot yet either\n");
	r = ssqch(["build", "--root", d]);
	assert.ok(r.ok && r.log.includes("  Drafts  2 unconfirmed (built in development only)\n") && !exists(dir, "dist/wip"), r.log);
	r = ssqch(["build", "--format", "json", "--root", d]);
	try { report = JSON.parse(r.stdout); } catch (e) { throw new Error(`${e.message}: ${r.stdout}`); }
	assert.ok(r.ok && report.drafts === 2, r.stdout);
	r = ssqch(["build", "--env", "development", "--root", d]);
	assert.ok(r.ok && !r.log.includes("Drafts") && isFile(dir, "dist/wip/index.html"), r.log);

	// Nothing of ssqch's own is in what a build writes.
	for (const page of ["index.html", "about/index.html", "wip/index.html"]) {
		const html = read(dir, path.join("dist", page)).toLowerCase();
		assert.ok(!html.includes("squatch") && !html.includes("ssqch") && !html.includes("<!--"), `${page}: ${html}`);
	}

	// What's new and what's gone since the last build (the drafts, which development built).
	w("src/extra.md", "Extra\n");
	r = ssqch(["build", "--root", d]);
	assert.ok(r.ok && r.log.includes(" (1 new, 2 gone)\n") && !r.log.includes("Uninhabited"), r.log);
	r = ssqch(["build", "--format", "json", "--root", d]);
	try { report = JSON.parse(r.stdout); } catch (e) { throw new Error(`${e.message}: ${r.stdout}`); }
	assert.ok(r.ok && report.pages.new === 0 && report.pages.gone === 0, r.stdout);
	r = ssqch(["build", "--root", d]);
	assert.ok(r.ok && !r.log.includes(" new") && !r.log.includes(" gone"), r.log);

	// --verbose names the templates nothing used: the layout and the include from above. The
	// report has one themed line, and the drafts' comes first, so this one is plain.
	r = ssqch(["build", "--verbose", "--root", d]);
	assert.ok(r.ok && r.log.includes("  Drafts  2 unconfirmed (built in development only)\n") && r.log.includes("Unused: 2 templates that nothing used in this build (src/_includes/base.edge, src/_includes/partials/nav.edge).\n"), r.log);

	// Jinja, Nunjucks and EJS includes count too, whichever engine read them.
	const other = tempDir("uninhabited");
	write(other, {
		"ssqch.config.js": "export default { templateFormats: [\"jinja\", \"njk\", \"ejs\"] };\n",
		"_includes/nav.jinja": "<nav></nav>",
		"_includes/card.jinja": "<div></div>",
		"_includes/old.jinja": "old",
		"_includes/footer.ejs": "<footer></footer>",
		"_includes/spare.ejs": "spare",
		"_includes/hooks/heading.jinja": "<h{{ heading.level }}>{{ heading.text }}</h{{ heading.level }}>",
		"index.jinja": "{% include \"nav.jinja\" %}",
		"about.njk": "{% include \"card.jinja\" %}",
		"trail.ejs": "<%- include(\"footer\") %>",
	});
	// The site's first build: that's the report's themed line. The second's is this one.
	r = ssqch(["build", "--verbose", "--root", other]);
	assert.ok(r.ok && r.log.includes("First confirmed siting.") && r.log.includes("Unused: 2 templates that nothing used in this build (_includes/old.jinja, _includes/spare.ejs).\n"), r.log);
	r = ssqch(["build", "--verbose", "--root", other]);
	assert.ok(r.ok && r.log.includes("Uninhabited: 2 templates that nothing used in this build (_includes/old.jinja, _includes/spare.ejs).\n"), r.log);

	// Completions for a shell, with every command that's in --help.
	r = ssqch(["completions", "zsh"]);
	assert.ok(r.ok && r.log.includes("#compdef ssqch") && r.log.includes("inspect") && r.log.includes("capabilities") && !r.log.includes("sighting"), r.log);
	r = ssqch(["completions", "klingon"]);
	assert.ok(!r.ok && r.log.includes("possible values: bash, elvish, fish, powershell, zsh"), r.log);

	// `ssqch sighting` is there for whoever finds it, and knows when the site was last built.
	r = ssqch(["sighting", "--root", d]);
	assert.ok(r.ok && r.log.includes("Image quality meets cryptozoological standards.") && r.log.includes("Last confirmed siting: 3 pages in dist/, just now."), r.log);
	const help = ssqch(["--help"]).log;
	assert.ok(help.includes("inspect") && !help.includes("sighting"), help);
	const caps = ssqch(["capabilities", "--format", "json"]).log;
	assert.ok(!caps.includes("sighting"), caps);
});
