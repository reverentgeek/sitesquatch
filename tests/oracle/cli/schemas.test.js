// From crates/ssqch/tests/cli.rs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { ssqch, tempDir, write, read } from "../lib/ssqch.js";

test("schemas_check_every_page", () => {
	const dir = tempDir("schemas");
	const d = dir;
	write(dir, {
		"ssqch.config.js": `import { defineConfig } from "ssqch";
export default defineConfig({
  dirs: { input: "src", output: "dist" },
  schemas: {
    posts: {
      fields: {
        title: (value) => typeof value === "string" && value.length <= 20 || "must be a string of 20 characters or fewer",
        date: "date",
        description: "string?",
        status: "'draft' | 'published'",
        hero: { src: "file", alt: "string" },
        slug: "string",
      },
      unknown: "error",
    },
    guides: { files: "guides/**", fields: { order: "integer" }, unknown: "warn" },
  },
});
`,
	});
	write(dir, { "src/posts/posts.json": "{ \"tags\": \"posts\", \"computed\": { \"slug\": \"{{ page.fileSlug }}\" } }" });
	write(dir, { "src/posts/pine.md": "---\ntitle: Pine\ndate: 2026-03-14\nstatus: published\nhero: { src: pine.jpg, alt: A pine }\n---\nPine.\n" });
	write(dir, { "src/posts/pine.jpg": "jpg" });
	write(dir, { "src/guides/start.md": "---\norder: 1\n---\nStart.\n" });
	let r = ssqch(["build", "--root", d, "-q"]);
	assert.ok(r.ok, r.log);
	assert.ok(!r.log.includes("warn"), r.log);

	write(dir, { "src/posts/cedar.md": "---\ntitle: A title that goes on for far too long\nstatus: drfat\ndescripton: Typo\nhero: { src: cedar.jpg }\n---\nCedar.\n" });
	write(dir, { "src/guides/next.md": "---\norder: second\nlevel: 2\n---\nNext.\n" });
	r = ssqch(["build", "--root", d, "-q"]);
	assert.ok(!r.ok, r.log);
	for (const expected of [
		"7 content errors:",
		"  - src/posts/cedar.md: `date` is required (a date, like 2026-03-14) (schema `posts`)",
		"  - src/posts/cedar.md: `title` must be a string of 20 characters or fewer (schema `posts`)",
		"  - src/posts/cedar.md: `status` must be \"draft\" or \"published\", not \"drfat\" (schema `posts`)",
		"  - src/posts/cedar.md: `hero.src` is \"cedar.jpg\", but there's no such file next to the page (schema `posts`)",
		"  - src/posts/cedar.md: `hero.alt` is required (a string) (schema `posts`)",
		"  - src/posts/cedar.md: `descripton` isn't a field of this schema (did you mean `description`?) (schema `posts`)",
		"  - src/guides/next.md: `order` must be a whole number, not \"second\" (schema `guides`)",
		"warn: src/guides/next.md: `level` isn't a field of this schema (schema `guides`)",
	]) {
		assert.ok(r.log.includes(expected), `missing ${JSON.stringify(expected)} in\n${r.log}`);
	}

	// The schemas become types.
	r = ssqch(["types", "--root", d]);
	assert.ok(r.ok, r.log);
	assert.ok(r.log.includes("(with 2 schemas)"), r.log);
	const types = read(dir, "ssqch.d.ts");
	assert.ok(types.includes("\tinterface Schemas {\n\t\tposts: {\n\t\t\ttitle: any;\n\t\t\tdate: Date | string;\n\t\t\tdescription?: string;\n\t\t\tstatus: \"draft\" | \"published\";\n"), types);
	assert.ok(types.includes("\t\tguides: {\n\t\t\torder: number;\n\t\t};\n"), types);

	write(dir, { "ssqch.config.js": "export default { schemas: { posts: { title: \"string\" } } };\n" });
	r = ssqch(["build", "--root", d, "-q"]);
	assert.ok(!r.ok && r.log.includes("ssqch.config.js: schemas.posts: \"title\" isn't an option (options: fields, files, unknown); a schema's fields go in `fields`"), r.log);
});

// The new-docs run: `date: last Tuesday` failed the build with `in t.md: can't parse date "last
// Tuesday"` (no field, no line, the code `build`), and the page's missing title went unsaid.
// DELIBERATE (0.13.5): a `front-matter` error that points at the line, with the schemas' errors.
test("a_date_that_isnt_one_points_at_its_line", () => {
	const dir = tempDir("schema-bad-date");
	write(dir, {
		"ssqch.config.js": "export default { dirs: { input: \"src\" }, schemas: { page: { files: \"**/*.md\", fields: { title: \"string\" } } } };\n",
		"src/t.md": "---\ndescription: Pine cones\ndate: last Tuesday\n---\nHi\n",
	});
	let r = ssqch(["build", "--root", dir]);
	assert.ok(!r.ok, r.log);
	assert.ok(r.log.includes("2 content errors:\n  - src/t.md: `date` isn't a date: \"last Tuesday\". Write it as 2026-11-22, or with a time, 2026-11-22T09:30:00Z\n  - src/t.md: `title` is required (a string) (schema `page`)\n"), r.log);
	assert.ok(r.log.includes("  --> src/t.md:3\n") && r.log.includes("   3 | date: last Tuesday\n"), r.log);
	r = ssqch(["build", "--root", dir, "--format", "json"]);
	const [first] = JSON.parse(r.stdout).errors;
	assert.deepEqual([first.code, first.file, first.field], ["front-matter", "src/t.md", "date"], r.stdout);
	// Without a schema, the same error.
	write(dir, { "ssqch.config.js": "export default { dirs: { input: \"src\" } };\n" });
	r = ssqch(["build", "--root", dir]);
	assert.ok(!r.ok && r.log.includes("1 content error:\n  - src/t.md: `date` isn't a date"), r.log);
});

// Added in 0.14 (Squatch Snacks, E1 and E6). A paginated template's problems say which item each
// is on (six errors that all said `src/snack.jinja` sent the site to rule functions on made-up
// fields), and a misspelled required field is one problem, not a "required" and then, second, the
// "isn't a field" that says what happened.
test("schema_problems_name_the_item_and_the_misspelling", () => {
	const dir = tempDir("schemas-items");
	write(dir, {
		"ssqch.config.js": "export default { dirs: { input: \"src\", output: \"dist\" }, templateFormats: [\"jinja\", \"md\"], schemas: { snacks: { files: \"snack.jinja\", fields: { title: \"string\", price: \"number\" } }, events: { files: \"events/*.md\", fields: { title: \"string\", location: \"string\" }, unknown: \"error\" } } };\n",
		"src/_data/snacks.json": "[{ \"name\": \"Pine Cone Crunch\", \"price\": 3 }, { \"name\": \"Ridge Runner Jerky\" }]",
		"src/snack.jinja": "---\npagination: { data: snacks, size: 1, alias: snack }\npermalink: \"/snacks/{{ snack.name | slugify }}/\"\ntitle: Snack\ncomputed:\n  price: \"{{ snack.price }}\"\n---\n{{ snack.name }}\n",
		"src/events/hike.md": "---\ntitle: Hike\nloaction: Cedar Trail\n---\nGo\n",
	});
	const r = ssqch(["build", "--root", dir, "-q"]);
	assert.ok(!r.ok, r.log);
	for (const expected of [
		"3 content errors:",
		"  - src/events/hike.md: `location` is required (a string), and the page has `loaction`: did you mean `location`? (schema `events`)",
		"  - src/snack.jinja (item 1 of snacks, \"Pine Cone Crunch\"): `price` must be a number, not \"3\" (schema `snacks`)",
		"  - src/snack.jinja (item 2 of snacks, \"Ridge Runner Jerky\"): `price` must be a number, not \"\" (schema `snacks`)",
	]) {
		assert.ok(r.log.includes(expected), `missing ${JSON.stringify(expected)} in\n${r.log}`);
	}
	assert.ok(!r.log.includes("isn't a field"), r.log);
});
