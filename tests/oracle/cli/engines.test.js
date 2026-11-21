// From crates/ssqch/tests/cli.rs.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { ssqch, tempDir, write, read, exists, project } from "../lib/ssqch.js";

test("jinja_is_the_default_and_other_templates_are_named", () => {
	const dir = tempDir("default-engine");
	const d = dir;
	const w = (p, t) => write(dir, { [p]: t });
	// No config: .jinja pages render, and Markdown and HTML run through Jinja first.
	w("_includes/base.jinja", "<main>{% if title %}<h1>{{ title }}</h1>{% endif %}{{ content }}</main>");
	w("index.jinja", "---\nlayout: base.jinja\ntitle: Camp\n---\n{% for n in [1, 2] %}{{ n }}{% endfor %}");
	w("trail.md", "---\nlayout: base.jinja\n---\n{{ \"cedar\" | upper }} trail");
	w("ranger.html", "{% set who = \"ranger\" %}<p>{{ who }}</p>");
	let r = ssqch(["build", "--root", d]);
	assert.ok(r.ok && !r.log.includes("warn"), r.log);
	const rd = (p) => read(dir, `_site/${p}`);
	assert.equal(rd("index.html"), "<main><h1>Camp</h1>12</main>");
	assert.equal(rd("trail/index.html"), "<main><p>CEDAR trail</p>\n</main>");
	assert.equal(rd("ranger/index.html"), "<p>ranger</p>");

	// A template in a language the site has but doesn't list is named, not left out quietly.
	w("old.edge", "@if(true)\nold\n@end\n");
	w("older.edge", "{{ 'older' }}");
	r = ssqch(["build", "--root", d]);
	assert.ok(r.ok && r.log.includes("warn: 2 .edge files aren't rendered (old.edge, older.edge): templateFormats is jinja, md, html. Add \"edge\" to render them, or list them in `ignore`."), r.log);
	assert.ok(!exists(dir, "_site/old"));
	fs.rmSync(path.join(dir, "older.edge"));
	const o = ssqch(["build", "--root", d, "--format", "json"]);
	let json;
	try { json = JSON.parse(o.stdout); } catch (e) { assert.fail(`${e.message}: ${o.stdout}`); }
	assert.deepEqual(json.warnings, [{ code: "template-formats", message: "old.edge isn't rendered: templateFormats is jinja, md, html. Add \"edge\" to render it, or list it in `ignore`.", file: "old.edge" }], JSON.stringify(json));
	// Listed, it renders; ignored, it's quiet.
	w("ssqch.config.js", "export default { templateFormats: [\"jinja\", \"edge\", \"md\", \"html\"] };\n");
	r = ssqch(["build", "--root", d]);
	assert.ok(r.ok && !r.log.includes("warn") && rd("old/index.html").includes("old"), r.log);
	w("ssqch.config.js", "export default { ignore: [\"old.edge\"] };\n");
	r = ssqch(["build", "--root", d]);
	assert.ok(r.ok && !r.log.includes("warn"), r.log);
});

test("jinja_errors_point_at_the_name_and_say_what_was_meant", () => {
	const dir = tempDir("jinja-errors");
	const d = dir;
	const w = (p, t) => write(dir, { [p]: t });
	w("ssqch.config.js", "export default { filters: { shout: s => s } };\n");
	w("_includes/partials/nav.jinja", "<nav></nav>");
	w("_includes/base.jinja", "{{ content }}");
	// The line, the message, and what the carets go under.
	const cases = [
		["{% include \"partials/navv.jinja\" %}", "template not found: can't include `partials/navv.jinja` (did you mean `partials/nav.jinja`?)", "partials/navv.jinja"],
		["{% extends \"bse.jinja\" %}", "template not found: no template named `bse.jinja` (did you mean `base.jinja`?)", "bse.jinja"],
		["{{ title | uper }}", "unknown filter `uper` (did you mean `upper`?)", "uper"],
		["{{ title | shot }}", "unknown filter `shot` (did you mean `shout`?)", "shot"],
		["{{ shoutt(title) }}", "unknown function `shoutt` (did you mean `shout`?)", "shoutt"],
		["{% if 3 is od %}{% endif %}", "unknown test `od` (did you mean `odd`?)", "od"],
		["{{ title | frobnicate }}", "unknown filter `frobnicate`\n", "frobnicate"],
	];
	for (const [line, message, under] of cases) {
		w("index.jinja", `---\ntitle: Camp\n---\n${line}\n`);
		const r = ssqch(["build", "--root", d]);
		// The file's own line, as the frame below numbers it.
		assert.ok(!r.ok && r.log.includes(`index.jinja:4: ${message}`), `${line}\n${r.log}`);
		const column = line.lastIndexOf(under);
		const frame = `  --> index.jinja:4\n   2 | title: Camp\n   3 | ---\n   4 | ${line}\n     | ${" ".repeat(column)}${"^".repeat(under.length)}`;
		assert.ok(r.log.includes(frame), `${line}\n${r.log}\nwanted:\n${frame}`);
	}
});

test("ejs_templates_render_as_ejs_does", () => {
	const dir = tempDir("ejs");
	const d = dir;
	const w = (p, t) => write(dir, { [p]: t });
	const rd = (p) => read(dir, `_site/${p}`);
	w("ssqch.config.js", "export default { templateFormats: [\"ejs\", \"md\"], markdownEngine: \"ejs\", filters: { shout: s => String(s).toUpperCase() + \"!\" } };\n");
	w("_includes/partials/card.ejs", "<div class=\"card\"><%= name %><% if (typeof extra !== \"undefined\") { %> (<%= extra %>)<% } %></div>\n");
	// The output of EJS 3.1.10 for each template, with the same data.
	const cases = [
		["<h1><%= title %></h1>\n<p><%- html %></p>\n<p><%= html %></p>\n", "<h1>Squatch &lt;Snacks&gt;</h1>\n<p><b>bold</b></p>\n<p>&lt;b&gt;bold&lt;/b&gt;</p>\n"],
		["<ul>\n<% items.forEach(function (item) { -%>\n  <li><%= item.name %> is <%= item.n * 2 %></li>\n<% }) -%>\n</ul>\n", "<ul>\n  <li>pine cone is 4</li>\n  <li>Crunch is 6</li>\n</ul>\n"],
		["<ul>\n  <%_ for (const item of items) { _%>\n    <li><%= item.name %></li>\n  <%_ } _%>\n</ul>\n", "<ul>\n    <li>pine cone</li>\n    <li>Crunch</li>\n</ul>\n"],
		["a <%# a comment %> b <%% literal %> c\n<%= undefined %>|<%= null %>|<%- null %>|<%= 0 %>|<%= false %>\n", "a  b <% literal %> c\n|||0|false\n"],
		["<%- include('partials/card', { name: 'Cedar' }) %>\n<%- include('partials/card', { name: 'Old Growth', extra: 'x' }) %>\n", "<div class=\"card\">Cedar</div>\n\n<div class=\"card\">Old Growth (x)</div>\n\n"],
		["<% const shout = s => s.toUpperCase(); %><%= shout(title) %>\n<%= locals.title %> <%= typeof missing %>\n", "SQUATCH &lt;SNACKS&gt;\nSquatch &lt;Snacks&gt; undefined\n"],
		["<%= title; %>\n<%\n  let total = 0;\n  for (const i of items) total += i.n;\n%>\nTotal: <%= total %>\n", "Squatch &lt;Snacks&gt;\n\nTotal: 5\n"],
		["Quotes: <%= q %>\n<% if (items.length > 1) { %>many<% } else { %>one<% } %>\n", "Quotes: &#34;a&#34; &amp; &#39;b&#39;\nmany\n"],
		// An include inside an include gets its parent's data too, and names can be Unicode.
		["<%- include('outer', { animal: 'fox' }) %>\n<%= café %>\n", "[fox|fox|undefined][fox|fox|string]\nowl\n"],
		// A name used only after `...` is a variable, not a property.
		["<%= [...animals].join(\",\") %>|<%= Object.keys({...trailInfo}).join() %>|<%= Math.max(...nums) %>\n", "fox,owl|name|2\n"],
	];
	w("_includes/outer.ejs", "[<%- include(\"inner\") %>][<%- include(\"inner\", { trail: \"Cedar\" }) %>]");
	w("_includes/inner.ejs", "<%= animal %>|<%= locals.animal %>|<%= typeof trail %>");
	const data = "---\ncafé: owl\nanimals: [fox, owl]\ntrailInfo: { name: Cedar }\nnums: [1, 2]\ntitle: \"Squatch <Snacks>\"\nhtml: \"<b>bold</b>\"\nq: \"\\\"a\\\" & 'b'\"\nitems:\n  - { name: pine cone, n: 2 }\n  - { name: Crunch, n: 3 }\n";
	cases.forEach(([source], i) => {
		w(`cases/c${i}.ejs`, `${data}permalink: /c${i}.html\n---\n${source}`);
	});
	// A Markdown post in an EJS layout, with a config filter, one of ssqch's functions and collections.
	w("_includes/base.ejs", "<main><%- content %></main><footer><%= shout(\"stump\") %> <%- markdown(\"*Pine*\", \"inline\") %> <%= page.url %></footer>\n");
	w("trail.md", "---\nlayout: base.ejs\ntitle: Trail\n---\n# <%= title %>\n\n<%= collections.all.length %> pages.\n");
	let r = ssqch(["build", "--root", d]);
	assert.ok(r.ok && !r.log.includes("warn"), r.log);
	cases.forEach(([source, want], i) => {
		assert.equal(rd(`c${i}.html`), want, source);
	});
	assert.equal(rd("trail/index.html"), "<main><h1 id=\"trail\">Trail</h1>\n<p>11 pages.</p>\n</main><footer>STUMP! <em>Pine</em> /trail/</footer>\n");

	// Errors name the template and line, and the frame shows the file's own lines.
	const fails = (source, message) => {
		w("bad.ejs", `---\ntitle: x\n---\nline one\n${source}\n`);
		const r = ssqch(["build", "--root", d]);
		assert.ok(!r.ok && r.log.includes(`rendering bad.ejs with \`ejs\`: bad.ejs:5: ${message}`) && r.log.includes("  --> bad.ejs:5\n"), `${source}\n${r.log}`);
		return r.log;
	};
	fails("<%= nope.x %>", "nope is not defined");
	fails("<% if (true) { %>open", "a block opened in a <% %> tag isn't closed (a `}` is missing)");
	fails("<% if (x) {", "this <% tag is never closed (with %>)");
	const log = fails("<%- include('partials/crd') %>", "template not found: can't include `partials/crd`: no sightings in _includes (did you mean `partials/card`?)");
	assert.ok(log.includes("   5 | <%- include('partials/crd') %>\n     |              ^^^^^^^^^^^^\n"), log);
	fs.rmSync(path.join(dir, "bad.ejs"));
});

test("render_front_matter_picks_the_engines", () => {
	const dir = tempDir("render");
	const d = dir;
	const w = (p, t) => write(dir, { [p]: t });
	w("default.md", "---\nname: Bigfoot\n---\nHi {{ name }}\n");
	w("md-only.md", "---\nname: Bigfoot\nrender: md\n---\nHi {{ name }}\n");
	w("chain.md", "---\nname: Bigfoot\nrender: [edge, md]\n---\n*{{ name }}*\n");
	w("raw.md", "---\nrender: false\n---\n*{{ name }}*\n");
	let r = ssqch(["build", "--root", d]);
	assert.ok(r.ok, r.log);
	const rd = (name) => read(dir, `_site/${name}/index.html`);
	assert.equal(rd("default"), "<p>Hi Bigfoot</p>\n");
	assert.equal(rd("md-only"), "<p>Hi {{ name }}</p>\n");
	assert.equal(rd("chain"), "<p><em>Bigfoot</em></p>\n");
	assert.equal(rd("raw"), "*{{ name }}*\n");

	// Eleventy's name for it works too, and so does its comma-separated list.
	w("old.md", "---\nname: Bigfoot\ntemplateEngineOverride: \"edge,md\"\n---\n*{{ name }}*\n");
	r = ssqch(["build", "--root", d]);
	assert.ok(r.ok && r.log.includes("note: templateEngineOverride works; ssqch calls it render (ssqch docs render)"), r.log);
	assert.equal(rd("old"), "<p><em>Bigfoot</em></p>\n");
	w("old.md", "---\ntemplateEngineOverride: md\nrender: md\n---\nHi\n");
	r = ssqch(["build", "--root", d]);
	assert.ok(!r.ok && r.log.includes("`templateEngineOverride` and `render` are two names for one key; set one of them"), r.log);
	fs.rmSync(path.join(dir, "old.md"));

	w("bad.md", "---\nrender: 3\n---\nHi\n");
	r = ssqch(["build", "--root", d]);
	assert.ok(!r.ok && r.log.includes("`render` must be an engine name"), r.log);
});

test("the_config_can_define_template_engines", () => {
	const dir = tempDir("js-engines");
	const d = dir;
	const w = (p, t) => write(dir, { [p]: t });
	const config = (engines, formats) => `export default { templateFormats: [${formats}], markdownEngine: "tmpl", engines: { ${engines} } };\n`;
	const engines = String.raw`
        shout: (source) => source.toUpperCase(),
        tmpl: {
            prefix: "~",
            async render(source, data) {
                return this.prefix + source.replace(/\$\{(\w+)\}/g, (_, key) => String(data[key] ?? ""));
            },
        },`;
	w("ssqch.config.js", config(engines, "\"shout\", \"tmpl\", \"md\""));
	w("_includes/frame.tmpl", "<frame>${content}</frame>");
	w("loud.shout", "hello, squatch\n");
	w("hi.tmpl", "---\nname: Bigfoot\nlayout: frame\n---\nHi ${name}");
	w("post.md", "---\nname: Bigfoot\n---\n*${name}*\n");
	let r = ssqch(["build", "--root", d]);
	assert.ok(r.ok, r.log);
	const rd = (p) => read(dir, `_site/${p}`);
	assert.equal(rd("loud/index.html"), "HELLO, SQUATCH\n");
	assert.equal(rd("hi/index.html"), "~<frame>~Hi Bigfoot</frame>");
	assert.equal(rd("post/index.html"), "<p>~<em>Bigfoot</em></p>\n");

	// Returning something other than a string names the engine and the file.
	w("ssqch.config.js", config("shout: () => 42,", "\"shout\""));
	r = ssqch(["build", "--root", d]);
	assert.ok(!r.ok && r.log.includes("engine \"shout\" returned number for loud.shout"), r.log);

	// Built-in engines can't be replaced.
	// DELIBERATE (0.11): except Markdown. `md` can be the site's own (a markdown-it), so a move
	// that keeps its Markdown library replaces it once (a11y #12; see
	// a_sites_engine_can_replace_markdown_once below).
	w("ssqch.config.js", config("edge: (s) => s,", "\"md\""));
	r = ssqch(["build", "--root", d]);
	assert.ok(!r.ok && r.log.includes("engines.edge: \"edge\" is built in"), r.log);
});

// Found in migrations: keeping a site's markdown-it took an engine of its own plus `render` in
// every folder's data, and `render` from a folder's data reached its `.njk` pages too (v8.dev
// changed nine content files for it, a11y #12). `engines: { md }` replaces Markdown once: `.md`
// files and `md` in a chain use it, with the `markdownEngine` still first, and an object with
// markdown-it's `render(source, env)` works as it is.
test("a_sites_engine_can_replace_markdown_once", () => {
	const dir = tempDir("engine-md");
	const w = (p, t) => write(dir, { [p]: t });
	// Like markdown-it: a `render` method that reads `this`, and gets the page's data as `env`.
	const mdit = "{ tag: \"mdit\", render(source, env, context) { return `<${this.tag} title=\"${env.title}\" kind=\"${context.kind}\">${source.trim()}</${this.tag}>\\n`; } }";
	w("ssqch.config.js", `export default { templateFormats: ["md", "njk", "jinja"], markdownEngine: "jinja", engines: { md: ${mdit} } };\n`);
	w("_includes/base.njk", "<main>{{ content | safe }}</main>{{ markdown(\"*ssqch*\") | safe }}");
	w("posts/pine.md", "---\ntitle: Pine\nlayout: base.njk\n---\n*{{ title | upper }}*\n");
	w("posts/cedar.njk", "---\ntitle: Cedar\n---\n*{{ title }}*");
	w("chain.jinja", "---\ntitle: Chain\nrender: [jinja, md]\n---\n{{ 1 + 1 }}");
	let r = ssqch(["build", "--root", dir]);
	assert.ok(r.ok, r.log);
	const rd = (p) => read(dir, `_site/${p}`);
	// Jinja first, then the site's Markdown; the `markdown` filter is still ssqch's.
	assert.equal(rd("posts/pine/index.html"), "<main><mdit title=\"Pine\" kind=\"body\">*PINE*</mdit>\n</main><p><em>ssqch</em></p>\n");
	// A Nunjucks page in the same folder isn't Markdown, and doesn't become it.
	assert.equal(rd("posts/cedar/index.html"), "*Cedar*");
	assert.equal(rd("chain/index.html"), "<mdit title=\"Chain\" kind=\"body\">2</mdit>\n");

	// A `markdown` filter of the site's own takes the built-in one's place, and Jekyll's
	// `markdownify`, an alias of it, calls the site's too.
	w("ssqch.config.js", `export default { templateFormats: ["md", "liquid"], engines: { md: ${mdit} }, filters: { markdown: (text) => \`<mine>\${text}</mine>\` } };\n`);
	w("feed.liquid", "{{ \"*a*\" | markdownify }}|{{ \"*b*\" | markdown }}");
	r = ssqch(["build", "--root", dir]);
	assert.ok(r.ok, r.log);
	assert.equal(rd("feed/index.html"), "<mine>*a*</mine>|<mine>*b*</mine>");
});

// v8.dev's serve rebuild went from 1.8 s to 0.28 s with a cache of markdown-it's output in its
// config. `cache: true` keeps an engine's page bodies by their source; layouts render each time.
test("a_sites_engine_can_cache_what_it_renders", () => {
	const dir = tempDir("engine-cache");
	const w = (p, t) => write(dir, { [p]: t });
	const config = (cache) => `let calls = 0;\nexport default { templateFormats: ["md", "mdit"], markdownEngine: false, engines: { mdit: { cache: ${cache}, render: (source, data, context) => context.kind === "layout" ? \`[\${data.content}]\` : \`<p>\${source.trim()} \${++calls}</p>\` } } };\n`;
	w("ssqch.config.js", config("true"));
	w("_includes/frame.mdit", "frame");
	for (const name of ["a", "b", "c"]) w(`${name}.md`, `---\nrender: mdit\nlayout: frame.mdit\n---\n${name === "c" ? "Cedar" : "Pine"}\n`);
	let r = ssqch(["build", "--root", dir]);
	assert.ok(r.ok, r.log);
	const rd = (p) => read(dir, `_site/${p}`);
	// Two pages with the same text render once; the layout renders for each page.
	assert.equal(rd("a/index.html"), "[<p>Pine 1</p>]");
	assert.equal(rd("b/index.html"), "[<p>Pine 1</p>]");
	assert.equal(rd("c/index.html"), "[<p>Cedar 2</p>]");

	w("ssqch.config.js", config("false"));
	r = ssqch(["build", "--root", dir]);
	assert.ok(r.ok, r.log);
	assert.equal(rd("b/index.html"), "[<p>Pine 2</p>]");

	w("ssqch.config.js", config("\"yes\""));
	r = ssqch(["build", "--root", dir]);
	assert.ok(!r.ok && r.log.includes("engines.mdit.cache must be true or false"), r.log);
});

test("liquid_templates_get_filters_includes_and_collections", () => {
	const dir = tempDir("liquid");
	const d = dir;
	const w = (p, t) => write(dir, { [p]: t });
	w("ssqch.config.js", "export default {\n  dirs: { input: \"src\", output: \"dist\" },\n  templateFormats: [\"liquid\", \"md\", \"edge\"],\n  filters: { shout: (s) => String(s).toUpperCase(), wrap: (s, l, r) => l + s + r },\n  collections: { posts: (pages) => pages.byTag(\"post\") },\n};\n");
	w("src/_includes/base.liquid", "<title>{{ title | shout }}</title>{% include nav.html section=\"home\" %}{{ content }}{% render \"footer\", year: 2026 %}");
	w("src/_includes/nav.html", "<nav>{{ include.section }}</nav>");
	w("src/_includes/footer.liquid", "<footer>{{ year }}</footer>");
	w("src/_includes/edge.edge", "<edge>{{ content }}</edge>");
	w("src/index.liquid", "---\nlayout: base\ntitle: Sightings\n---\n{{ collections.posts | size }} {{ \"x\" | wrap: \"[\", \"]\" }} [{{ nope }}{{ page.nope }}]{% for post in collections.posts %} {{ post.data.title | slugify }}@{{ post.date | date: \"%Y-%m-%d\" }}{% endfor %} {{ 3 | plus: 1 }} {{ 2.5 }}");
	w("src/edge-layout.liquid", "---\nlayout: edge\n---\n{{ \"liquid\" | upcase }}");
	w("src/posts/pine.md", "---\ntitle: Pine Cone Crunch\ntags: post\ndate: 2026-01-02\nlayout: base\n---\n*{{ title }}*\n");
	w("src/posts/brittle.md", "---\ntitle: Bigfoot Brittle\ntags: post\ndate: 2026-03-04\nrender: [liquid, md]\n---\n{{ title | downcase }}\n");
	let r = ssqch(["build", "--root", d]);
	assert.ok(r.ok, r.log);
	const rd = (p) => read(dir, `dist/${p}`);
	assert.equal(rd("index.html"), "<title>SIGHTINGS</title><nav>home</nav>2 [x] [] pine-cone-crunch@2026-01-02 bigfoot-brittle@2026-03-04 4 2.5<footer>2026</footer>");
	assert.equal(rd("edge-layout/index.html"), "<edge>LIQUID</edge>");
	// Markdown runs through Edge first by default; a Liquid layout wraps it.
	assert.equal(rd("posts/pine/index.html"), "<title>PINE CONE CRUNCH</title><nav>home</nav><p><em>Pine Cone Crunch</em></p>\n<footer>2026</footer>");
	assert.equal(rd("posts/brittle/index.html"), "<p>bigfoot brittle</p>\n");

	// Liquid errors name the template.
	w("src/broken.liquid", "{% if %}");
	r = ssqch(["build", "--root", d]);
	assert.ok(!r.ok && r.log.includes("broken.liquid"), r.log);
});

test("nunjucks_templates_get_filters_includes_and_collections", () => {
	const dir = tempDir("nunjucks");
	const d = dir;
	const w = (p, t) => write(dir, { [p]: t });
	w("ssqch.config.js", "export default {\n  dirs: { input: \"src\", output: \"dist\" },\n  templateFormats: [\"njk\", \"jinja\", \"md\"],\n  filters: { shout: (s) => String(s).toUpperCase(), year: (d) => d.getUTCFullYear() },\n  collections: { posts: (pages) => pages.byTag(\"post\") },\n};\n");
	w("src/_includes/base.njk", "<title>{{ title | shout }}</title>{% include \"nav.njk\" %}{{ content }}");
	w("src/_includes/nav.njk", "<nav>{% for p in collections.posts %}<a href=\"{{ p.url }}\">{{ p.data.title }}</a>{% endfor %}</nav>");
	w("src/_includes/frame.jinja", "<main>{% block body %}{% endblock %}</main>");
	w("src/index.njk", "---\nlayout: base.njk\ntitle: Sightings <&>\n---\n{{ title }} {{ shout(\"fn\") }} [{{ nope }}{{ nope.deeper }}] {% for p in collections.posts %}{{ p.date | year }}{% endfor %}{% if false %}{% elseif true %} elseif{% endif %}{% set o = {\"a\": 1} %}{% for k, v in o %} {{ k }}={{ v }}{% endfor %} {{ \"the quick fox\" | truncate(9) }}");
	w("src/extends.jinja", "{% extends \"frame.jinja\" %}{% block body %}{{ \"<b>\" | safe }}{% endblock %}");
	w("src/posts/pine.md", "---\ntitle: Pine Cone Crunch\ntags: post\ndate: 2026-01-02\nrender: [njk, md]\n---\n*{{ title | lower }}*\n");
	let r = ssqch(["build", "--root", d]);
	assert.ok(r.ok, r.log);
	const rd = (p) => read(dir, `dist/${p}`);
	assert.equal(rd("index.html"), "<title>SIGHTINGS &lt;&amp;&gt;</title><nav><a href=\"/posts/pine/\">Pine Cone Crunch</a></nav>Sightings &lt;&amp;&gt; FN [] 2026 elseif a=1 the...");
	assert.equal(rd("extends/index.html"), "<main><b></main>");
	assert.equal(rd("posts/pine/index.html"), "<p><em>pine cone crunch</em></p>\n");

	// Errors name the template and line.
	w("src/broken.njk", "ok\n{% if %}");
	r = ssqch(["build", "--root", d]);
	assert.ok(!r.ok && r.log.includes("broken.njk:2: syntax error"), r.log);
});

// Two silent bugs found moving a11yproject.com: a quoted word in a post's text that names an
// include reading `collections` emptied the post's `templateContent` in the feed, and an
// apostrophe in a Nunjucks comment turned off `.length` for the rest of the file.
test("quotes_in_prose_and_comments_dont_change_the_output", () => {
	const dir = tempDir("quotes-in-prose");
	const d = dir;
	const w = (p, t) => write(dir, { [p]: t });
	w("ssqch.config.js", "export default {\n  dirs: { input: \"src\", output: \"dist\" },\n  templateFormats: [\"njk\", \"md\"],\n  collections: { posts: (pages) => pages.byTag(\"post\") },\n};\n");
	w("src/_includes/footer.njk", "FOOT {{ collections.posts | length }}");
	w("src/_includes/base.njk", "{{ content | safe }}{% include \"footer.njk\" %}");
	w("src/posts/a.md", "---\nlayout: base.njk\ntags: post\nrender: [njk, md]\n---\nThe \"footer\" of a page.\n");
	w("src/feed.njk", "---\npermalink: feed.xml\n---\n{% for post in collections.posts %}[{{ post.templateContent | length }}]{% endfor %}");
	w("src/comment.njk", "{% set y = 'abc' %}A[{{ y.length }}]\n{# we don't #}\nB[{{ y.length }}]{% if 1 !== 2 %} ok{% endif %}");
	let r = ssqch(["build", "--root", d]);
	assert.ok(r.ok, r.log);
	const rd = (p) => read(dir, `dist/${p}`);
	assert.equal(rd("feed.xml"), "[41]");
	assert.equal(rd("comment/index.html"), "A[3]\n\nB[3] ok");

	// Nunjucks escapes `\` as `&#92;` (v8.dev's feeds); Jinja leaves it.
	w("ssqch.config.js", "export default { dirs: { input: \"src\", output: \"dist\" }, templateFormats: [\"njk\", \"jinja\"] };\n");
	w("src/slash.njk", "---\nwin: 'C:\\trail <a>'\n---\n{{ win }} {{ win | escape }} {{ win | safe }}");
	w("src/slash2.jinja", "---\nwin: 'C:\\trail <a>'\n---\n{{ win }}");
	r = ssqch(["build", "--root", d]);
	assert.ok(r.ok, r.log);
	assert.equal(rd("slash/index.html"), "C:&#92;trail &lt;a&gt; C:&#92;trail &lt;a&gt; C:\\trail <a>");
	assert.equal(rd("slash2/index.html"), "C:\\trail &lt;a&gt;");
});

// What a stage 3 review of the Node build found it doing differently from 0.7, without a word:
// async functions outside a plain `{{ }}`, Jinja's truth, `~`, `==` and `%`, tuples, macros that
// see the page's data, and `set` on shared data.
test("jinja_keeps_its_meaning_in_every_corner", () => {
	const dir = tempDir("jinja-corners");
	const d = dir;
	const w = (p, t) => write(dir, { [p]: t });
	const rd = (p) => read(dir, `_site/${p}`);
	w("ssqch.config.js", "export default { templateFormats: [\"njk\", \"jinja\"], filters: { later: async (s) => `L:${s}`, nope: async () => false } };\n");
	w("_data/site.json", "{ \"title\": \"Pine Cone Crunch\", \"url\": \"https://example.com\", \"empty\": [] }");
	w("_includes/macros.njk", "{% macro link(path) %}<a href=\"{{ site.url }}{{ path }}\">{{ site.title }}</a>{% endmacro %}{% macro tag(x) %}<t>{{ x | later }}</t>{% endmacro %}");
	w("async.njk", "[{{ later(\"b\") }}]{% set v = later(\"c\") %}[{{ v }}]{% if nope() %}t{% else %}f{% endif %}|{% from \"macros.njk\" import tag %}{{ tag(\"a\") }}|{% set cap %}{{ \"e\" | later }}{% endset %}[{{ cap }}]|{% filter upper %}{{ \"d\" | later }}{% endfilter %}|{{ [\"i\", \"j\"] | map(\"later\") | join(\",\") }}");
	w("truth.jinja", "{% if site.empty %}T{% else %}F{% endif %}|{{ site.empty or \"default\" }}|{{ \"yes\" if site.empty else \"no\" }}|{{ site.empty | default(\"d\", true) }}|[{{ missing ~ \" | \" ~ missing }}]|{{ \"a\" ~ none }}|{{ 0 == \"\" }}|{{ [1] == [1] }}|{{ -7 % 3 }}|{{ 3 > 2 > 1 }}");
	w("tuples.jinja", "{% for label, url in [(\"Home\", \"/\"), (\"Blog\", \"/blog/\")] %}<a href=\"{{ url }}\">{{ label }}</a>{% endfor %}|{{ (1, 2) }}|{% import \"macros.njk\" as m %}{{ m.link(\"/x/\") }}");
	let r = ssqch(["build", "--root", d]);
	assert.ok(r.ok, r.log);
	assert.equal(rd("async/index.html"), "[L:b][L:c]f|<t>L:a</t>|[L:e]|L:D|L:i,L:j");
	assert.equal(rd("truth/index.html"), "F|default|no|d|[ | ]|aNone|False|True|2|True");
	assert.equal(rd("tuples/index.html"), "<a href=\"/\">Home</a><a href=\"/blog/\">Blog</a>|(1, 2)|<a href=\"https://example.com/x/\">Pine Cone Crunch</a>");

	// Data the site shares isn't a template's to change.
	w("set.njk", "a\n{% set site.title = \"Changed\" %}");
	r = ssqch(["build", "--root", d]);
	assert.ok(!r.ok && r.log.includes("set.njk:2: invalid operation: can only assign to namespaces, not map"), r.log);
});

test("handlebars_and_mustache_templates_render", () => {
	const dir = tempDir("handlebars");
	const d = dir;
	const w = (p, t) => write(dir, { [p]: t });
	w("ssqch.config.js", "export default {\n  dirs: { input: \"src\", output: \"dist\" },\n  templateFormats: [\"hbs\", \"mustache\", \"md\"],\n  filters: { shout: (s) => String(s).toUpperCase(), wrap: (s, l, r) => l + s + r, opts: (s, o) => s + o.size },\n  collections: { posts: (pages) => pages.byTag(\"post\") },\n};\n");
	w("src/_includes/base.hbs", "<title>{{shout title}}</title>{{> nav}}{{{content}}}");
	w("src/_includes/nav.hbs", "<nav>{{#each collections.posts}}<a href=\"{{this.url}}\">{{this.data.title}}</a>{{/each}}</nav>");
	w("src/index.hbs", "---\nlayout: base.hbs\ntitle: Sightings <&>\n---\n{{title}} {{{title}}} [{{nope}}{{nope.deeper}}] {{wrap \"x\" \"[\" \"]\"}} {{opts \"o\" size=2}} {{len collections.posts}}{{^nothing}} none{{/nothing}}");
	w("src/list.mustache", "---\nname: Squatch\nitems: [a, b]\nflag: true\n---\nHi {{name}}{{#items}} {{.}}{{/items}}{{#flag}} yes{{/flag}}{{#missing}} no{{/missing}}{{^missing}} empty{{/missing}}");
	w("src/posts/pine.md", "---\ntitle: Pine Cone Crunch\ntags: post\ndate: 2026-01-02\nlayout: base.hbs\n---\n*hi*\n");
	let r = ssqch(["build", "--root", d]);
	assert.ok(r.ok, r.log);
	const rd = (p) => read(dir, `dist/${p}`);
	assert.equal(rd("index.html"), "<title>SIGHTINGS &lt;&amp;&gt;</title><nav><a href=\"/posts/pine/\">Pine Cone Crunch</a></nav>Sightings &lt;&amp;&gt; Sightings <&> [] [x] o2 1 none");
	assert.equal(rd("list/index.html"), "Hi Squatch a b yes empty");
	assert.equal(rd("posts/pine/index.html"), "<title>PINE CONE CRUNCH</title><nav><a href=\"/posts/pine/\">Pine Cone Crunch</a></nav><p><em>hi</em></p>\n");

	w("src/broken.hbs", "ok\n{{#if}}");
	r = ssqch(["build", "--root", d]);
	assert.ok(!r.ok && r.log.includes("broken.hbs"), r.log);
});

// Found reviewing the Node build: Liquid's own filters printed a date in the machine's time zone,
// whole numbers and floats divided alike, a missing value reached a function as `undefined`, and
// an async function made the template (and every other function in it) run again.
test("liquid_numbers_dates_and_functions_are_0_7s_in_any_time_zone", () => {
	const dir = tempDir("liquid-values");
	write(dir, {
		"ssqch.config.js": "let n = 0;\nexport default { templateFormats: [\"liquid\"], filters: { count: () => ++n, show: (v) => v === null ? \"null\" : typeof v, later: async (s) => \"later:\" + s } };\n",
		"index.liquid": "---\ndate: 2026-01-02\nratio: 2.5\n---\n[{{ date | append: \"x\" }}] [{{ date | truncate: 15 }}] [{{ date | size }}] [{{ date }}]\n[{{ 10 | times: 1.0 | divided_by: 4 }}] [{{ ratio | times: 2 | divided_by: 2 }}] [{{ 10.0 | divided_by: 4 }}] [{{ 7 | divided_by: 2 }}]\n[{{ nope | show }}] [{{ 1 | count }} {{ \"x\" | later }} {{ 1 | count }}]\n",
	});
	const r = ssqch(["build", "--root", dir], { env: { TZ: "America/Los_Angeles" } });
	assert.ok(r.ok, r.log);
	assert.equal(read(dir, "_site/index.html"), "[2026-01-02 00:00:00 +0000x] [2026-01-02 0...] [25] [2026-01-02 00:00:00 +0000]\n[2.5] [2.5] [2.5] [3]\n[null] [1 later:x 2]\n");
});

// The same review, for Handlebars: helpers got dates as `Date`s and missing values as
// `undefined`, ran again after an async helper, and `{{> nav}}` could be another engine's file.
test("handlebars_helpers_get_0_7s_values_and_run_once", () => {
	const dir = tempDir("handlebars-values");
	write(dir, {
		"ssqch.config.js": "let n = 0;\nexport default { templateFormats: [\"hbs\", \"njk\"], filters: { count: () => ++n, kind: (v) => v === null ? \"null\" : Object.prototype.toString.call(v), later: async (s) => \"later:\" + s } };\n",
		"_includes/nav.hbs": "<nav>hbs {{title}}</nav>",
		"index.hbs": "---\ntitle: T\ndate: 2026-01-02\n---\n{{> nav}} [{{kind date}}] [{{kind nope}}] [{{count}} {{later title}} {{count}}] [{{#each list}}{{@key}}{{/each}}]\n",
	});
	let r = ssqch(["build", "--root", dir]);
	assert.ok(r.ok, r.log);
	assert.equal(read(dir, "_site/index.html"), "<nav>hbs T</nav> [[object String]] [null] [1 later:T 2] []\n");
	// With `strict` on, a block helper's argument that isn't there is an error, as it was.
	write(dir, { "ssqch.config.js": "export default { strict: true, templateFormats: [\"hbs\"] };\n", "index.hbs": "---\ntitle: T\n---\nline\n{{#each nolist}}x{{/each}}\n" });
	r = ssqch(["build", "--root", dir]);
	assert.ok(!r.ok && r.log.includes("index.hbs") && r.log.includes("nolist"), r.log);
});

// The same review, for EJS: the page's data shadowed the names the engine's code uses.
test("ejs_keeps_its_own_names_when_the_data_has_them", () => {
	const dir = tempDir("ejs-names");
	write(dir, {
		"ssqch.config.js": "export default { templateFormats: [\"ejs\"] };\n",
		"_includes/p/nav.ejs": "<nav><%= title %></nav>",
		"a.ejs": "---\ntitle: A\ninclude: [a, b]\nescapeFn: 1\n---\n<%- include(\"p/nav\") %> <%= title %>\n",
	});
	const r = ssqch(["build", "--root", dir]);
	assert.ok(r.ok, r.log);
	assert.equal(read(dir, "_site/a/index.html"), "<nav>A</nav> A\n");
});

// Decided for 0.8 (CHANGELOG.md, 0.8.0): `.njk` prints values as Nunjucks does, as a site from
// Eleventy expects; Edge's `safe()` prints raw HTML; tags from functions work in `.jinja`; and
// Liquid splits by nothing and joins two items as Shopify and Jekyll do. 0.7 had no tags in
// `.jinja`, printed `True` and `['a', 'b']` in `.njk`, escaped `safe()`'s HTML, counted 5 and
// wrote "pine, and cedar".
test("printing_tags_and_sentences_as_0_8_decided", () => {
	const dir = tempDir("decided");
	write(dir, {
		"ssqch.config.js": "export default { dirs: { input: \"src\" }, templateFormats: [\"njk\", \"jinja\", \"edge\", \"liquid\"], filters: { image: (src) => `<img src=\"${src}\">` } };\n",
		"src/n.njk": "---\nok: true\ntags: [a, b]\n---\n{{ ok }}|{{ tags }}|{{ tags | dump | safe }}",
		"src/j.jinja": "---\nok: true\ntags: [a, b]\n---\n{{ ok }}|{{ tags }}",
		"src/t.jinja": "{% image \"/a.png\" %}",
		"src/e.edge": "---\nhtml: <b>pine</b>\n---\n{{ safe(html) }}",
		"src/l.liquid": "---\ntwo: [pine, cedar]\n---\n{{ \"abc\" | split: \"\" | size }}|{{ two | array_to_sentence_string }}",
	});
	const r = ssqch(["build", "--root", dir, "-q"]);
	const out = (name) => read(dir, `_site/${name}/index.html`);
	assert.ok(r.ok, r.log);
	assert.equal(out("n"), "true|a,b|[\"a\",\"b\"]");
	assert.equal(out("t"), "<img src=\"/a.png\">");
	assert.equal(out("e"), "<b>pine</b>");
	assert.equal(out("l"), "3|pine and cedar");
	assert.equal(out("j"), "True|[&#39;a&#39;, &#39;b&#39;]");
});

// expressjs.com (ex #3): an imported macro named like a config filter (`postCard`) hid the
// filter's function, and a card printed `function () { [native code] }` without a word. Each
// way a Nunjucks template can take a function's name is a warning with its file and line.
test("nunjucks_names_that_hide_a_function_are_warned_about", () => {
	const root = project({
		"ssqch.config.js": "export default { templateFormats: [\"njk\"], filters: { postCard: (p) => p, icon: (n) => n, label: (s) => s } };\n",
		"_includes/ui.njk": "{% macro postCard(post, icon) %}{{ post }}{{ icon(post) }}{% endmacro %}\n",
		"index.njk": "{% from \"ui.njk\" import postCard %}\n{% set label = 1 %}{{ label(2) }}\n{% for icon in [1] %}{{ icon(3) }}{% endfor %}\n{% import \"ui.njk\" as ui %}{{ postCard(1) }}{{ ui.postCard(2) }}\n",
		// A name the template doesn't call, and a filter after a pipe, aren't traps.
		"plain.njk": "{% set label = 1 %}{{ label }}{% set x = 1 | label(2) %}{% for item in [1] %}{{ item }}{% endfor %}\n",
	});
	// The build fails too: `label(2)` calls the number 1. The warnings say why.
	const r = ssqch(["build", "--root", root, "--format", "json"]);
	const warnings = JSON.parse(r.stdout).warnings.filter((w) => w.code === "template").map((w) => `${w.file}:${w.line} ${w.message.split(" has the name")[0].split(": ").pop()}`).sort();
	assert.deepEqual(warnings, [
		"_includes/ui.njk:1 the macro parameter `icon`",
		"index.njk:1 the imported macro `postCard`",
		"index.njk:2 the variable `label`",
		"index.njk:3 the loop variable `icon`",
	]);
});

// opensource.guide (osg #6, #8): Jekyll's `{% seo %}` is a plugin's tag, and the config's functions
// are tags in Liquid as they are in Nunjucks; `{% include_relative %}` reads beside the template.
test("liquid_config_functions_are_tags_and_include_relative_reads_beside_the_template", () => {
	const root = project({
		"ssqch.config.js": `export default { templateFormats: ["liquid", "md"], markdownEngine: "liquid", filters: {
	seo: (o) => "<title>" + (o?.title === false ? "" : "Squatch Snacks") + "</title>",
	image: (src, alt, o) => \`<img src="\${src}" alt="\${alt}"\${o?.width ? \` width="\${o.width}"\` : ""}>\`,
	callout: (body, kind) => \`<aside class="\${kind}">\${body.trim()}</aside>\`,
	later: async (x) => \`[\${x}]\`,
	include: () => "a filter, not a tag",
} };
`,
		"index.liquid": "---\ntitle: Pine Cone Crunch\n---\n{% seo %}|{% seo title=false %}|{% image \"/a.png\", \"A <pine>\" width: 3 %}|{% image \"/b.png\" \"B\" %}|{% callout \"tip\" %}On {{ title }}{% endcallout %}|{% later title %}\n",
		"guide/index.md": "---\ntitle: Cedar Trail\n---\n{% include_relative parts/intro.md who=\"rangers\" %}\n{% assign part = \"outro\" %}{% include_relative parts/{{ part }}.md %}\n",
		"guide/parts/intro.md": "Hello, {{ include.who }}, on {{ title }}.\n",
		"guide/parts/outro.md": "Leave no trace.\n",
		"_includes/x.liquid": "",
	});
	const r = ssqch(["build", "--root", root, "--quiet"]);
	assert.ok(r.ok, r.log);
	assert.equal(read(root, "_site/index.html"), "<title>Squatch Snacks</title>|<title></title>|<img src=\"/a.png\" alt=\"A <pine>\" width=\"3\">|<img src=\"/b.png\" alt=\"B\">|<aside class=\"tip\">On Pine Cone Crunch</aside>|[Pine Cone Crunch]\n");
	assert.match(read(root, "_site/guide/index.html"), /Hello, rangers, on Cedar Trail\./);
	assert.match(read(root, "_site/guide/index.html"), /Leave no trace\./);

	const broken = (template) => {
		const site = project({ "ssqch.config.js": "export default { templateFormats: [\"liquid\"], filters: { boom: () => { throw new Error(\"the snack drawer is empty\"); } } };\n", "guide/index.liquid": template });
		const b = ssqch(["build", "--root", site]);
		assert.ok(!b.ok);
		return b.log;
	};
	assert.match(broken("one\n{% boom 1 %}\n"), /guide\/index\.liquid:2: boom\(\): the snack drawer is empty/);
	assert.match(broken("{% boom \"x\" | upcase %}\n"), /a filter can't go in \{% boom %\}'s arguments \("\| upcase"\): `assign` the value first/);
	assert.match(broken("{% include_relative nope.md %}\n"), /include_relative "nope\.md": guide\/nope\.md not found/);
	assert.match(broken("{% include_relative ../x.md %}\n"), /include_relative "\.\.\/x\.md": the file has to be in the template's folder/);
});

// opensource.guide (osg #5): Jekyll's templates read front matter through `page` (`page.title`),
// which is empty in ssqch, where front matter is at the top level. No fallback (decided 2026-11-18):
// a warning, once for each name, naming the page, even when the read is in an include.
test("liquid_page_front_matter_reads_say_the_rename", () => {
	const root = project({
		"ssqch.config.js": "export default { templateFormats: [\"liquid\", \"md\"], markdownEngine: \"liquid\" };\n",
		"_includes/trail.liquid": "<h1>{{ page.title }}</h1>{{ page.url }}{% include head.liquid %}{{ content }}",
		"_includes/head.liquid": "<meta content=\"{{ page.description }}\">{{ page.lantern }}",
		"cedar.md": "---\nlayout: trail.liquid\ntitle: Cedar Trail\ndescription: Pine cones\n---\nx\n",
		"ridge.md": "---\nlayout: trail.liquid\ntitle: Ridge Trail\ndescription: Stumps\n---\nx\n",
	});
	const r = ssqch(["build", "--root", root]);
	assert.ok(r.ok, r.log);
	const said = (key) => r.log.split(`: \`page.${key}\` is empty: in ssqch, front matter is at the top level, so it's \`${key}\``).length - 1;
	assert.equal(said("title"), 1, r.log);
	assert.equal(said("description"), 1, r.log);
	// A key that isn't front matter either is just empty, as in Jekyll.
	assert.ok(!r.log.includes("page.lantern"), r.log);
	assert.match(r.log, /warn: rendering cedar\.md: `page\.title` is empty/);
});

// DELIBERATE (after 0.8.0): Liquid follows Ruby's Liquid (4.0.4, Jekyll's and GitHub Pages') where
// 0.7 followed the liquid crate (decided 2026-11-18, osg #7). Each expected string is what Ruby's
// Liquid 4.0.4 rendered for the same template. Math reads text as Ruby does, `split` drops empty
// strings at the end and splits `" "` at whitespace, and a block that only sets variables writes
// nothing.
test("liquid_follows_rubys_liquid", () => {
	const root = project({
		"ssqch.config.js": "export default { templateFormats: [\"liquid\"] };\n",
		"math.liquid": "{{ \"r>\" | times: 1 }}|{{ \"3\" | plus: 2 }}|{{ \"3.5x\" | minus: 1 }}|{{ \"\" | times: 2 }}|{{ nope | plus: 1 }}|{{ \"abc\" | divided_by: 1 }}|{{ \" 7 \" | plus: 1 }}|{{ \"1_000\" | plus: 1 }}",
		"split.liquid": "{{ \"a,b,,\" | split: \",\" | size }}|{{ \",a,b\" | split: \",\" | size }}|{{ \"a  b c\" | split: \" \" | join: \"/\" }}|{{ \" a b \" | split: \" \" | join: \"/\" }}|{{ \",,\" | split: \",\" | size }}",
		"blank.liquid": "a{% if true %}\n  {% assign x = 1 %}\n{% endif %}b|c{% for i in (1..2) %}\n  {% assign y = i %}\n{% endfor %}d|e{% if true %}\n  {{ x }}\n{% endif %}f|g{% unless false %} {% assign z = 2 %} {% comment %}x{% endcomment %} {% endunless %}h|i{% if false %}\n  {% assign w = 1 %}\n{% elsif true %}\n  out\n{% endif %}j",
	});
	const r = ssqch(["build", "--root", root, "--quiet"]);
	assert.ok(r.ok, r.log);
	assert.equal(read(root, "_site/math/index.html"), "0|5|2|0|1|0|8|1001");
	assert.equal(read(root, "_site/split/index.html"), "2|3|a/b/c|a/b|0");
	assert.equal(read(root, "_site/blank/index.html"), "ab|cd|e\n  1\nf|gh|i\n  out\nj");
});

// Found in migrations: a site's own engine (a markdown-it) rendered pages' permalinks too, so a
// URL came out as `<p>/tags/{{ tag }}/</p>`, and the engine couldn't tell a page from a layout
// or a permalink. A permalink renders with ssqch's template language (here the markdownEngine),
// and the engine is told what it's rendering: `{ kind, path }`.
test("a_sites_engine_is_told_what_it_renders_and_permalinks_skip_it", () => {
	const dir = tempDir("engine-context");
	const w = (p, t) => write(dir, { [p]: t });
	w("ssqch.config.js", "export default { templateFormats: [\"md\", \"mdit\"], markdownEngine: \"jinja\", engines: { mdit: (source, data, context) => `<p>${context.kind} ${context.path}: ${source.trim()}</p>` } };\n");
	w("_includes/frame.mdit", "frame");
	w("posts/pine.md", "---\nrender: mdit\ntag: Pine\npermalink: \"/tags/{{ tag | lower }}/\"\nlayout: frame.mdit\n---\nCones\n");
	let r = ssqch(["build", "--root", dir]);
	assert.ok(r.ok, r.log);
	assert.equal(read(dir, "_site/tags/pine/index.html"), "<p>layout ./_includes/frame.mdit: frame</p>");
	// The body, as the layout's `content` would have it, said `body` and the page's file.
	w("_includes/frame.mdit", "{{ content }}");
	w("ssqch.config.js", "export default { templateFormats: [\"md\", \"mdit\"], markdownEngine: \"jinja\", engines: { mdit: (source, data, context) => context.kind === \"layout\" ? data.content : `<p>${context.kind} ${context.path}: ${source.trim()}</p>` } };\n");
	r = ssqch(["build", "--root", dir]);
	assert.ok(r.ok, r.log);
	assert.equal(read(dir, "_site/tags/pine/index.html"), "<p>body ./posts/pine.md: Cones</p>");

	// A permalink that comes out with tags still in it, or as a paragraph, is an error, not a URL.
	w("posts/pine.md", "---\npermalink: \"{{ '<p>' | safe }}pine/\"\n---\nCones\n");
	r = ssqch(["build", "--root", dir]);
	assert.ok(!r.ok && r.log.includes("isn't a URL: it was rendered with `jinja`"), r.log);
});

// Found in the fresh a11yproject.com move: `{{ date.toString() }}` printed `[object Undefined]`,
// with no warning, in every post's JSON-LD (the table of UTC date methods is an object, and its
// `toString` was Object's). A date's methods are its own, as in Eleventy, in the site's timeZone.
test("a_dates_own_methods_work_in_templates", () => {
	const dir = tempDir("date-methods");
	write(dir, {
		"ssqch.config.js": "export default { templateFormats: [\"njk\"], timeZone: \"UTC\" };\n",
		"post.njk": "---\ndate: 2020-05-01\n---\n{{ date.toString() }}|{{ page.date.toISOString() }}|{{ date.getFullYear() }}",
	});
	const r = ssqch(["build", "--root", dir]);
	assert.ok(r.ok, r.log);
	assert.equal(read(dir, "_site/post/index.html"), "Fri May 01 2020 00:00:00 GMT+0000 (Coordinated Universal Time)|2020-05-01T00:00:00.000Z|2020");
});

// Found in the fresh a11yproject.com move: a layout's `content` reached the site's own filters as a
// SafeString, so a table-of-contents filter that checks `typeof content === "string"` gave "" on 70
// pages, silently. The site's functions get text, as in Eleventy; what comes back unchanged is
// still HTML.
test("site_filters_get_a_layouts_content_as_text", () => {
	const dir = tempDir("filters-safe-string");
	write(dir, {
		"ssqch.config.js": "export default { templateFormats: [\"njk\", \"md\"], filters: { kind: (c) => typeof c, same: (c) => c, shout: (c) => typeof c === \"string\" ? c.toUpperCase() : \"\" } };\n",
		"_includes/base.njk": "{{ content | kind }}|{{ content | same }}|{{ content | shout | safe }}|{{ content }}",
		"pine.md": "---\nlayout: base.njk\n---\n*Pine*\n",
	});
	const r = ssqch(["build", "--root", dir]);
	assert.ok(r.ok, r.log);
	assert.equal(read(dir, "_site/pine/index.html"), "string|<p><em>Pine</em></p>\n|<P><EM>PINE</EM></P>\n|<p><em>Pine</em></p>\n");
});

// Eleventy's `url` normalized its path (the rerun of a11yproject.com: `""` was `.` in its menus).
test("the_url_alias_normalizes_as_eleventys_did", () => {
	const dir = tempDir("url-alias");
	write(dir, { "ssqch.config.js": "export default { templateFormats: [\"njk\"] };\n", "index.njk": "{{ \"\" | url }}|{{ nope | url }}|{{ \"/a//b/../c/\" | url }}|{{ \"https://x.dev//y\" | url }}|{{ \"rel/x\" | url }}" });
	const r = ssqch(["build", "--root", dir]);
	assert.ok(r.ok, r.log);
	assert.equal(read(dir, "_site/index.html"), ".|.|/a/c/|https://x.dev//y|rel/x");
});

// Added in 0.11, from the fresh opensource.guide move: Jekyll's filters as Jekyll writes them.
// `xml_escape` is Ruby's (`&apos;`; liquidjs wrote `&#39;`), `normalize_whitespace` folds ASCII
// whitespace and trims, and `sort` of an object gives its `[key, value]` pairs by key (the
// language menus).
test("jekylls_liquid_filters_write_what_jekyll_writes", () => {
	const dir = tempDir("jekyll-filters");
	write(dir, {
		"ssqch.config.js": "export default { templateFormats: [\"liquid\"], data: { langs: { fr: \"Français\", de: \"Deutsch\", ar: \"عربي\" } } };\n",
		"index.liquid": "{{ \"l'Open & <b>\" | xml_escape }}|{{ \"  a   \n\t b  \" | normalize_whitespace }}|{% assign pairs = langs | sort %}{% for p in pairs %}{{ p[0] }}={{ p[1] }},{% endfor %}|{{ \"b,a\" | split: \",\" | sort | join: \",\" }}",
	});
	const r = ssqch(["build", "--root", dir, "-q"]);
	assert.ok(r.ok, r.log);
	assert.equal(read(dir, "_site/index.html"), "l&apos;Open &amp; &lt;b&gt;|a   b|ar=عربي,de=Deutsch,fr=Français,|a,b");
});

// Added in 0.11, from the fresh www.ruby-lang.org move: Jekyll's own tags and Ruby's Liquid 4
// filters, Jekyll's date form (3,545 posts), and a front matter key written twice (4 posts).
test("jekylls_tags_dates_and_rubys_truncate", () => {
	const dir = tempDir("jekyll-tags");
	write(dir, {
		"ssqch.config.js": "export default { templateFormats: [\"liquid\", \"md\"] };\n",
		"en/news/_posts/_posts.json": "{ \"permalink\": \"/en/news/{{ page.fileSlug }}/\" }\n",
		"en/news/_posts/2016-07-26-pine.md": "---\ntitle: English\ntitle: Pine\ndate: 2009-12-25 10:41:06 +0000\n---\nPine\n",
		"index.liquid": "{% highlight ruby %}\nputs \"<hi>\"\n{% endhighlight %}|{% link en/news/_posts/2016-07-26-pine.md %}|{% post_url 2016-07-26-pine %}|{{ collections.all | where: \"url\", \"/en/news/pine/\" | map: \"data\" | map: \"title\" | first }} {{ collections.all | where: \"url\", \"/en/news/pine/\" | map: \"date\" | first | date: \"%Y-%m-%d %H:%M\" }}|{{ \"ббб\" | truncate: 5 }}|{{ \"a b c\" | truncatewords: 3 }}|{{ \"a\tb\" | truncatewords: 1 }}",
	});
	let r = ssqch(["build", "--root", dir]);
	assert.ok(r.ok, r.log);
	assert.ok(r.log.includes("warn: ./en/news/_posts/2016-07-26-pine.md: front matter has `title` twice (line 3); the last one is used, as Jekyll uses it"), r.log);
	assert.equal(read(dir, "_site/index.html"), "<figure class=\"highlight\"><pre><code class=\"language-ruby\" data-lang=\"ruby\"><span class=\"hl-function\">puts</span> <span class=\"hl-string\">&quot;&lt;hi&gt;&quot;</span></code></pre></figure>|/en/news/pine/|/en/news/pine/|Pine 2009-12-25 10:41|ббб|a b c...|a...");
	write(dir, { "bad.liquid": "{% link nope.md %}" });
	r = ssqch(["build", "--root", dir, "-q"]);
	assert.ok(!r.ok && r.log.includes("{% link nope.md %}: no page at nope.md"), r.log);
});

// Added in 0.11: a config filter written as a `function` gets the page being rendered as
// `this.page` (and its data as `this.data`), and `safe()` marks its answer as HTML, in every
// template language. Four fresh moves wanted both (MkDocs' page-relative `url` filter, among them).
test("filters_see_the_page_and_can_answer_with_html", () => {
	const dir = tempDir("this-page");
	write(dir, {
		"ssqch.config.js": "import { safe } from \"ssqch\";\nexport default {\n  templateFormats: [\"jinja\", \"njk\", \"liquid\", \"edge\", \"hbs\", \"ejs\", \"md\"],\n  filters: {\n    here: function (x) { return `${x}@${this.page.url}:${this.data.title}`; },\n    bold: (t) => safe(`<b>${t}</b>`),\n    later: async function (x) { await new Promise((r) => setTimeout(r, 5)); return `${x}~${this.page.url}`; },\n  },\n};\n",
		"_includes/lay.jinja": "{{ \"L\" | here }}|{{ content }}",
		"j.jinja": "---\ntitle: J\n---\n{{ \"a\" | here }} {{ \"b\" | bold }} {{ \"c\" | later }}",
		"n.njk": "---\ntitle: N\n---\n{{ \"a\" | here }} {{ \"b\" | bold }} {{ \"c\" | later }}",
		"l.liquid": "---\ntitle: L\n---\n{{ \"a\" | here }} {{ \"b\" | bold }} {{ \"c\" | later }}",
		"e.edge": "---\ntitle: E\n---\n{{ here(\"a\") }} {{ bold(\"b\") }} {{ await later(\"c\") }}",
		"h.hbs": "---\ntitle: H\n---\n{{here \"a\"}} {{bold \"b\"}}",
		"x.ejs": "---\ntitle: X\n---\n<%= here(\"a\") %> <%= bold(\"b\") %> <%= await later(\"c\") %>",
		"m.md": "---\ntitle: M\nlayout: lay.jinja\n---\nbody\n",
	});
	const r = ssqch(["build", "--root", dir, "-q"]);
	assert.ok(r.ok, r.log);
	const out = (p) => read(dir, `_site/${p}/index.html`);
	assert.equal(out("j"), "a@/j/:J <b>b</b> c~/j/");
	assert.equal(out("n"), "a@/n/:N <b>b</b> c~/n/");
	assert.equal(out("l"), "a@/l/:L <b>b</b> c~/l/");
	assert.equal(out("e"), "a@/e/:E <b>b</b> c~/e/");
	assert.equal(out("h"), "a@/h/:H <b>b</b>");
	assert.equal(out("x"), "a@/x/:X <b>b</b> c~/x/");
	// In a layout, it's the page the layout is rendering.
	assert.equal(out("m"), "L@/m/:M|<p>body</p>\n");
});

// Added in 0.11: `mkdocsTemplates: true` gives templates MkDocs' context, so an MkDocs theme's
// templates (Material's) run as written: every fresh MkDocs move wrote it by hand (~220 lines).
test("mkdocs_templates_see_mkdocs_context", () => {
	const dir = tempDir("mkdocs-templates");
	write(dir, {
		"mkdocs.yml": "site_name: Trail & Co\nsite_url: https://example.com/\nnav:\n  - Home: index.md\n  - Trails:\n    - trails/cedar.md\n",
		"ssqch.config.js": "export default { dirs: { input: \"docs\", output: \"site\" }, theme: \"theme\", mkdocsTemplates: true, markdownEngine: false };\n",
		"theme/_includes/main.html": "{% extends \"base.html\" %}",
		"theme/_includes/base.html": "<title>{{ page.title }} - {{ config.site_name }}</title><link href=\"{{ 'assets/app.css' | url }}\">{% for item in nav %}[{{ item.title }}{% if item.active %}*{% endif %}]{% endfor %}<b>{{ base_url }}</b>{% for t in page.toc %}({{ t.title }}{% for c in t.children %}/{{ c.title }}{% endfor %}){% endfor %}<main>{{ page.content }}</main>{% if page.next_page %}<next>{{ page.next_page.url | url }}</next>{% endif %}",
		"theme/_includes/404.html": "<h1>Lost{% if page %} in {{ page.title }}{% endif %}</h1><link href=\"{{ 'assets/app.css' | url }}\">",
		"theme/assets/app.css": "body { color: pine }\n",
		"docs/index.md": "# Camp\n\n## Water\n",
		"docs/trails/cedar.md": "# Cedar\n",
	});
	const r = ssqch(["build", "--root", dir, "-q"]);
	assert.ok(r.ok, r.log);
	// Nothing escaped, as in MkDocs' Jinja; URLs from the page; the nav with the page active.
	assert.equal(read(dir, "site/index.html"), "<title>Home - Trail & Co</title><link href=\"assets/app.css\">[Home*][Trails]<b>.</b>(Camp/Water)<main><h1 id=\"camp\">Camp</h1>\n<h2 id=\"water\">Water</h2>\n</main><next>trails/cedar/</next>");
	assert.equal(read(dir, "site/trails/cedar/index.html"), "<title>Cedar - Trail & Co</title><link href=\"../../assets/app.css\">[Home][Trails*]<b>../..</b>(Cedar)<main><h1 id=\"cedar\">Cedar</h1>\n</main>");
	// MkDocs' 404 page, from the theme's 404.html, with no page and the site's path.
	assert.equal(read(dir, "site/404.html"), "<h1>Lost</h1><link href=\"/assets/app.css\">");
	assert.equal(read(dir, "site/assets/app.css"), "body { color: pine }\n");
});
