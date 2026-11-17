// From crates/ssqch/tests/cli.rs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { ssqch, tempDir, write, read } from "../lib/ssqch.js";

test("nunjucks_tags_from_config_functions_and_jinja_dates", () => {
	const dir = tempDir("njk-tags");
	const d = dir;
	write(dir, {
		"ssqch.config.js": "export default {\n  dirs: { input: \"src\", output: \"dist\" },\n  templateFormats: [\"njk\", \"jinja\"],\n  filters: {\n    image: (src, alt) => `<img src=\"${src}\" alt=\"${alt}\">`,\n    callout: (content, kind = \"note\") => `<aside class=\"${kind}\">${content.trim()}</aside>`,\n    include: () => \"never called\",\n  },\n};\n",
		"src/_includes/part.njk": "part",
		"src/index.njk": "---\ntitle: Pines\nimage: /hero.png\n---\n{% image \"/a.png\", title %}\n{%- callout \"tip\" -%}\n  Watch for <b>{{ title }}</b>.\n{%- endcallout %}\n{% callout %}Plain{% endcallout %}\n{% markdown %}*md* in a template{% endmarkdown %}{% include \"part.njk\" %} {{ image | upper }} {{ \"/b.png\" | image(\"B\") | safe }}",
		"src/dates.jinja": "---\nwhen: 2026-03-14T09:05:00Z\ncount: 2\n---\n{{ when | dateformat }}|{{ when | dateformat(\"full\") }}|{{ when | datetimeformat(\"short\") }}|{{ when | timeformat }}|{{ when | dateformat(\"%B %-d, %Y\") }}|{{ \"2024-12-25\" | dateformat(\"long\") }}|{{ now().strftime(\"%Y\") | length }}{{ page.date.isoformat() | length }}|{{ count }} pine{{ count | pluralize }}|{{ 2048 | filesizeformat }}|{{ \"<b>bold</b>\" | striptags }}",
	});
	const r = ssqch(["build", "--root", d, "-q"]);
	assert.ok(r.ok, r.log);
	const out = (p) => read(dir, `dist/${p}`);
	assert.equal(
		out("index.html"),
		"<img src=\"/a.png\" alt=\"Pines\"><aside class=\"tip\">Watch for <b>Pines</b>.</aside>\n<aside class=\"note\">Plain</aside>\n<p><em>md</em> in a template</p>\npart /HERO.PNG <img src=\"/b.png\" alt=\"B\">",
	);
	assert.equal(out("dates/index.html"), "Mar 14 2026|Saturday, March 14 2026|2026-03-14 09:05|09:05|March 14, 2026|December 25 2024|425|2 pines|2.0 kB|bold");
});

test("slugs_take_a_separator_and_a_slugger_counts", () => {
	const dir = tempDir("slugger");
	const d = dir;
	write(dir, {
		"ssqch.config.js": "export default { dirs: { input: \"src\", output: \"dist\" }, templateFormats: [\"njk\", \"liquid\"] };\n",
		"src/_data/albums.js": "import { slugger, slugify } from \"ssqch\";\nconst slug = slugger();\nconst names = [\"Misc Pictures\", \"Cedar Trail\", \"Misc Pictures\", \"Misc Pictures 1\", \"Misc Pictures\"];\nexport default names.map((name) => ({ name, slug: slug(name), snake: slugify(name, { separator: \"_\" }) }));\n",
		"src/album.njk": "---\npagination:\n  data: albums\n  size: 1\n  alias: album\npermalink: \"photos/{{ album.slug }}/\"\n---\n{{ album.name }}",
		"src/index.njk": "{% for a in albums %}/photos/{{ a.slug }}/ {{ a.snake }}\n{% endfor %}{{ \"Taco Bake!\" | slugify({ separator: \"_\" }) }} {{ slugify(\"Pine Cone Crunch\", \"\") }} {{ \"Old Growth\" | slugify }} {{ \"Drew's Brownies\" | slugify(\"_\") }} {{ \"Drew's Brownies\" | slugify({ separator: \"_\", apostrophes: \"separate\" }) }}",
		"src/liquid.liquid": "{{ \"Taco Bake\" | slugify: \"_\" }}",
	});
	let r = ssqch(["build", "--root", d, "-q"]);
	assert.ok(r.ok, r.log);
	const out = (p) => read(dir, `dist/${p}`);
	assert.equal(out("index.html"), "/photos/misc-pictures/ misc_pictures\n/photos/cedar-trail/ cedar_trail\n/photos/misc-pictures-1/ misc_pictures\n/photos/misc-pictures-1-1/ misc_pictures_1\n/photos/misc-pictures-2/ misc_pictures\ntaco_bake pineconecrunch old-growth drews_brownies drew_s_brownies");
	assert.equal(out("photos/misc-pictures-2/index.html"), "Misc Pictures");
	assert.equal(out("liquid/index.html"), "taco_bake");
	// Another option is an error.
	write(dir, { "src/liquid.liquid": "{{ \"Taco Bake\" | slugify }}" });
	write(dir, { "src/index.njk": "{{ \"x\" | slugify({ sep: \"_\" }) }}" });
	r = ssqch(["build", "--root", d, "-q"]);
	assert.ok(!r.ok && r.log.includes("slugify: unknown option `sep` (options: separator, apostrophes)"), r.log);
	write(dir, { "src/index.njk": "{{ \"x\" | slugify({ apostrophes: \"keep\" }) }}" });
	r = ssqch(["build", "--root", d, "-q"]);
	assert.ok(!r.ok && r.log.includes("slugify: `apostrophes` is \"drop\" or \"separate\", not keep"), r.log);
});

const u32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32BE(n); return b; };
const HEAD = Buffer.from("\x89PNG\r\n\x1a\n\0\0\0\rIHDR", "latin1");

test("files_lists_a_folder_as_data", () => {
	const dir = tempDir("files");
	const d = dir;
	// A 3x2 PNG: the signature, then an IHDR chunk with the width and height.
	const png = Buffer.concat([HEAD, u32(3), u32(2), Buffer.from("\x08\x06\0\0\0\0\0\0\0", "latin1")]);
	write(dir, {
		"images/camp/20011222_08.PNG": png,
		"images/camp/2002-01-05-stump.png": png,
		"images/camp/notes.txt": "not a photo",
		"images/camp/old/20000101_01.png": png,
		"src/downloads/trail-map.png": "not really",
		"ssqch.config.js": "export default { dirs: { input: \"src\", output: \"dist\" }, templateFormats: [\"jinja\"] };\n",
		"src/_data/photos.js": "import { files } from \"ssqch\";\nexport default { camp: files(\"images/camp/*.png\", { dimensions: true }), deep: files(\"images/**/*.png\").length, maps: files(\"src/downloads/*\") };\n",
		"src/index.jinja": "{% for p in photos.camp %}{{ p.path }} {{ p.url }} {{ p.name }} {{ p.stem }} {{ p.ext }} {{ p.date | dateformat(\"%Y-%m-%d\") }} {{ p.dateFrom }} {{ p.width }}x{{ p.height }} {{ p.size }}\n{% endfor %}{{ photos.maps[0].dateFrom }} {{ photos.deep }} {{ photos.maps[0].url }} {{ photos.maps[0].width is undefined }}",
	});
	let r = ssqch(["build", "--root", d, "-q"]);
	assert.ok(r.ok, r.log);
	assert.equal(
		read(dir, "dist/index.html"),
		"images/camp/20011222_08.PNG /images/camp/20011222_08.PNG 20011222_08.PNG 20011222_08 png 2001-12-22 name 3x2 33\nimages/camp/2002-01-05-stump.png /images/camp/2002-01-05-stump.png 2002-01-05-stump.png 2002-01-05-stump png 2002-01-05 name 3x2 33\nmodified 3 /downloads/trail-map.png True",
	);
	// Sizes are kept between builds, and read again when a file changes.
	const cache = read(dir, ".cache/ssqch/image-sizes.json");
	assert.ok(cache.includes("\"images/camp/20011222_08.PNG\"") && !cache.includes("trail-map"), cache);
	const wide = Buffer.concat([HEAD, u32(30), u32(20), Buffer.from("\x08\x06\0\0\0\0\0\0\0\0", "latin1")]);
	write(dir, { "images/camp/20011222_08.PNG": wide });
	r = ssqch(["build", "--root", d, "-q"]);
	assert.ok(r.ok, r.log);
	assert.ok(read(dir, "dist/index.html").startsWith("images/camp/20011222_08.PNG /images/camp/20011222_08.PNG 20011222_08.PNG 20011222_08 png 2001-12-22 name 30x20 34\n"));
	// Used wrong: an unknown option, and a glob that leaves the project.
	write(dir, { "src/_data/photos.js": "import { files } from \"ssqch\";\nexport default files(\"images/*.jpg\", { size: true });\n" });
	r = ssqch(["build", "--root", d, "-q"]);
	assert.ok(!r.ok && r.log.includes("files(): unknown option \"size\" (options: dimensions)"), r.log);
	write(dir, { "src/_data/photos.js": "import { files } from \"ssqch\";\nexport default files(\"../*.jpg\");\n" });
	r = ssqch(["build", "--root", d, "-q"]);
	assert.ok(!r.ok && r.log.includes("files(\"../*.jpg\"): the glob is from the project root, and can't leave it"), r.log);
});

test("a_byte_order_mark_is_skipped_in_data_pages_and_scripts", () => {
	const dir = tempDir("bom");
	const d = dir;
	const bom = (files) => write(dir, Object.fromEntries(Object.entries(files).map(([k, v]) => [k, `﻿${v}`])));
	// Each file starts with EF BB BF, as SQL Server's and Windows editors' exports do.
	bom({
		"ssqch.config.js": "import { readData } from \"ssqch\";\nexport default { dirs: { input: \"src\", output: \"dist\" }, data: { ranger: readData(\"ranger.yml\") } };\n",
		"ranger.yml": "name: Ranger Rick\n",
		"src/_data/snacks.json": "[\"Squatch Snacks\", \"Pine Cone Crunch\"]",
		"src/_data/trail.toml": "name = \"Cedar\"\n",
		"src/_data/creatures.js": "export default [\"owl\", \"elk\"];\n",
		"src/_includes/base.jinja": "---\nsite: Old Growth\n---\n<main>{{ content }}</main>",
		"src/index.jinja": "---\nlayout: base.jinja\ntitle: Camp\n---\n{{ title }}|{{ site }}|{{ snacks[1] }}|{{ trail.name }}|{{ creatures[0] }}|{{ ranger.name }}",
	});
	const r = ssqch(["build", "--root", d, "-q"]);
	assert.ok(r.ok, r.log);
	assert.equal(read(dir, "dist/index.html"), "<main>Camp|Old Growth|Pine Cone Crunch|Cedar|owl|Ranger Rick</main>");
});

test("length_counts_lists_and_strings_in_nunjucks_and_jinja", () => {
	const dir = tempDir("jinja-length");
	const d = dir;
	const page = "{{ trail.snacks.length }}|{{ trail.snacks[1].length }}|{% set xs = [1, 2, 3] %}{{ xs.length }}|{% for s in trail.snacks %}{{ loop.length }}{% endfor %}|{{ trail.sign.length }}|{% if trail.snacks.length > 1 %}more{% endif %}|{{ \"a.length\" }}";
	write(dir, {
		"ssqch.config.js": "export default {\n  dirs: { input: \"src\", output: \"dist\" },\n  templateFormats: [\"njk\", \"jinja\"],\n  strict: true,\n};\n",
		"src/_data/trail.json": "{ \"snacks\": [\"Squatch Snacks\", \"Pine Cone Crunch\"], \"sign\": { \"length\": \"3 miles\" } }",
		"src/index.njk": page,
		"src/jinja.jinja": page,
	});
	const r = ssqch(["build", "--root", d, "-q"]);
	assert.ok(r.ok, r.log);
	const want = "2|16|3|22|3 miles|more|a.length";
	assert.equal(read(dir, "dist/index.html"), want);
	assert.equal(read(dir, "dist/jinja/index.html"), want);
});
