// The shape of every JSON document ssqch prints with --format json (and the ready file): its keys
// and their types, recursively, as ssqch 0.7.0 printed them. `schemaVersion` changes only when a
// field is removed or changes meaning (README, "Scripts and coding agents"), so a new key is
// allowed and a missing or retyped one isn't. Values are checked by the behavior tests in cli/.
//
//   SSQCH_FREEZE_SHAPES=1 node --test contract/shapes.test.js     rewrites shapes.json (0.7.0 only)
//   SSQCH_FREEZE_SHAPES=new node --test contract/shapes.test.js   adds the shapes it doesn't have
//
// A document 0.7 didn't print gets its shape from the version that adds it (decided 2026-11-18),
// listed in ADDED. `new` writes only those: every shape already in shapes.json stays as it is.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { ORACLE, project, ssqch, write } from "../lib/ssqch.js";
import { serveSite } from "../lib/serve.js";

const FILE = path.join(ORACLE, "contract/shapes.json");
const frozen = fs.existsSync(FILE) ? JSON.parse(fs.readFileSync(FILE, "utf8")) : {};
const freezing = process.env.SSQCH_FREEZE_SHAPES === "1";
const freezingNew = process.env.SSQCH_FREEZE_SHAPES === "new";
/** Documents 0.7.0 didn't print, and the version whose shape is frozen for each. */
const ADDED = { "diff (several builds)": "0.8.1", "build --profile": "0.10.1", "scout": "0.11.0", "diff --text": "0.12.0", "patrol": "0.13.0" };
const shapes = {};

/** A value's shape: "string", "number", "boolean", "null", { key: shape }, or [shape of every element merged]. */
export function shapeOf(v) {
	if (v === null) return "null";
	if (Array.isArray(v)) return [v.reduce((acc, x) => merge(acc, shapeOf(x)), undefined) ?? "empty"];
	if (typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, shapeOf(x)]));
	return typeof v;
}
// Two shapes of the same field: objects merge their keys; different scalar types join as "a|b".
function merge(a, b) {
	if (a === undefined) return b;
	if (Array.isArray(a) && Array.isArray(b)) return [a[0] === "empty" ? b[0] : b[0] === "empty" ? a[0] : merge(a[0], b[0])];
	if (a && b && typeof a === "object" && typeof b === "object" && !Array.isArray(a) && !Array.isArray(b)) {
		const out = { ...a };
		for (const [k, v] of Object.entries(b)) out[k] = k in out ? merge(out[k], v) : v;
		return out;
	}
	if (JSON.stringify(a) === JSON.stringify(b)) return a;
	const parts = new Set([...String(typeof a === "string" ? a : JSON.stringify(a)).split("|"), ...String(typeof b === "string" ? b : JSON.stringify(b)).split("|")]);
	return [...parts].sort().join("|");
}

/** Every path in `expected` must be in `actual` with the same type; `actual` may have more. */
function missing(expected, actual, at = "") {
	const out = [];
	if (typeof expected === "string") {
		if (expected === "empty") return out;
		const allowed = expected.split("|");
		const got = typeof actual === "string" ? actual.split("|") : [Array.isArray(actual) ? "array" : "object"];
		for (const g of got) if (g !== "empty" && !allowed.includes(g) && !(allowed.includes("null") && g === "null")) out.push(`${at || "(top)"}: was ${expected}, now ${typeof actual === "string" ? actual : JSON.stringify(actual)}`);
		return out;
	}
	if (Array.isArray(expected)) {
		if (!Array.isArray(actual)) return [`${at}: was a list, now ${JSON.stringify(actual)}`];
		if (actual[0] === "empty") return out;
		return missing(expected[0], actual[0], `${at}[]`);
	}
	if (typeof actual !== "object" || actual === null || Array.isArray(actual)) return [`${at}: was an object, now ${JSON.stringify(actual)}`];
	for (const [k, v] of Object.entries(expected)) {
		if (!(k in actual)) out.push(`${at}.${k}: missing`);
		else out.push(...missing(v, actual[k], `${at}.${k}`));
	}
	return out;
}

function check(name, ...documents) {
	const shape = documents.map(shapeOf).reduce((a, b) => merge(a, b));
	shapes[name] = shape;
	if (freezing) return;
	if (!frozen[name] && freezingNew && ADDED[name]) return;
	assert.ok(frozen[name], ADDED[name] ? `no frozen shape for ${name} (added in ${ADDED[name]}): run SSQCH_FREEZE_SHAPES=new` : `no frozen shape for ${name}: run SSQCH_FREEZE_SHAPES=1 against 0.7.0, or list it in ADDED`);
	const problems = missing(frozen[name], shape);
	assert.deepEqual(problems, [], `${name} lost or changed fields:\n  ${problems.join("\n  ")}`);
}

const json = (args, options) => {
	const r = ssqch([...args, "--format", "json"], options);
	try { return JSON.parse(r.stdout); } catch { throw new Error(`ssqch ${args.join(" ")} --format json printed no JSON:\n${r.log}`); }
};

// A site that fills every part of a build report: warnings with hints, aliases, a summary, copies.
const site = () => project({
	"ssqch.config.js": `import { linksPlugin } from "ssqch/links";\nexport default { dirs: { input: "src", output: "dist" }, templateFormats: ["md", "njk"], pathPrefix: "/", passthrough: ["./src/cones.txt"], plugins: [linksPlugin()] };\n`,
	"src/index.md": "---\ntitle: Trailhead\npublished: false\n---\n# Hello\n\n[About](/about/)\n",
	"src/about.md": "---\ntitle: About\n---\nThe stump.\n",
	"src/cones.txt": "pine\n",
	"src/_blueprints/posts.md": "---\ntitle: {{ title }}\ndate: {{ date }}\n---\n",
}, "shapes");

test("build report", () => {
	const dir = site();
	const ok = json(["build", "--root", dir]);
	// A second build has counts for new and gone pages where the first has null.
	write(dir, { "src/new.md": "New\n" });
	const again = json(["build", "--root", dir]);
	const failed = json(["build", "--root", project({ "ssqch.config.js": "export default { pineCones: 1 };\n" })]);
	const broken = json(["build", "--root", project({ "ssqch.config.js": "export default { dirs: { input: \"src\" } };\n", "src/index.njk": "line\n{{ x | nope }}\n" })]);
	assert.equal(ok.schemaVersion, 1);
	check("build", ok, again);
	check("build (failed)", failed, broken);
});

// `--profile` adds where the time went: every kind, each with a name, its calls and its time.
test("build report, profiled", () => {
	const dir = project({
		"ssqch.config.js": "export default { dirs: { input: \"src\", output: \"dist\" }, templateFormats: [\"md\", \"njk\"], filters: { shout: (s) => String(s).toUpperCase() }, transforms: { tidy: (html) => html }, collections: { posts: (api) => api.byTag(\"posts\") }, beforeBuild: [() => {}] };\n",
		"src/_data/site.json": "{ \"name\": \"Ranger Station\" }\n",
		"src/_includes/base.njk": "<main>{{ content | safe }}</main>\n",
		"src/index.njk": "---\nlayout: base.njk\ntags: posts\n---\n{{ site.name | shout }}\n",
	}, "shapes-profile");
	const report = json(["build", "--root", dir, "--profile"]);
	for (const kind of ["pages", "templates", "layouts", "engines", "filters", "transforms", "data", "collections", "hooks"]) assert.ok(report.profile[kind].length > 0, `no ${kind} in the profile`);
	check("build --profile", report);
	// Without --profile there's no profile.
	assert.equal(json(["build", "--root", dir]).profile, undefined);
});

// `ssqch scout --format json`, with every list filled: a to-do, a draft, an edit and a rename, what
// the reference build needs, and what the config does already.
test("scout_json_shape", () => {
	const dir = project({
		"_config.yml": "title: Trail\nurl: https://example.com\n",
		"Gemfile": "gem \"github-pages\"\n",
		"_layouts/default.html": "<head>{% seo %}</head>{{ content }}",
		"_data/trails.yml": "- Cedar\n",
		"_posts/2026-01-02-pine.md": "---\ntitle: Pine\n---\n<div markdown=\"1\">*a*</div>\n",
		"index.md": "---\nlayout: default\n---\nHi\n",
	}, "shapes-scout");
	const report = json(["scout", dir, "--write-draft", "--patch", path.join(dir, "move.patch")]);
	for (const list of ["todo", "draft", "edits"]) assert.ok(report[list].length > 0, `no ${list} in the report`);
	assert.ok(report.build.needs.length > 0, "nothing the build needs");
	// An MkDocs site fills the counts, the options and the page count, and --compare its comparison.
	const mkdocs = project({
		"mkdocs.yml": "site_name: Trail\nsite_url: https://example.com/trail/\nmarkdown_extensions:\n  - admonition\n",
		"docs/index.md": "# Trail\n\n!!! tip\n    Water\n\n[Cedar](cedar.md)\n",
		"docs/cedar.md": "# Cedar\n",
	}, "shapes-scout-mkdocs");
	const fresh = json(["scout", mkdocs, "--write-draft"]);
	assert.ok(fresh.todo.some((t) => t.count !== null && t.option !== null) && fresh.summary.pages === 2, JSON.stringify(fresh));
	// A reference that differs from ssqch's build in one file, so the comparison has a group.
	// Built at the time `--compare` pins (2026-01-01, outside git), as `ssqch baseline` builds a reference.
	assert.ok(ssqch(["build", "--root", mkdocs, "-q"], { env: { SOURCE_DATE_EPOCH: "1767225600" } }).ok);
	fs.cpSync(path.join(mkdocs, "site"), path.join(mkdocs, "ref"), { recursive: true });
	for (const file of ["ref/index.html", "ref/cedar/index.html"]) fs.appendFileSync(path.join(mkdocs, file), "<p>Fresh tracks</p>\n");
	const compared = json(["scout", mkdocs, "--compare", "--reference", "ref"]);
	// The draft's config sets the options, so the second run counts them as done.
	assert.ok(compared.done.length > 0 && compared.summary.done === compared.done.length, JSON.stringify(compared));
	assert.ok(compared.compare.built && compared.compare.summary.changed === 2 && compared.compare.groups.length === 1, JSON.stringify(compared.compare));
	check("scout", report, fresh, compared);
});

test("inspect report", () => {
	const dir = site();
	ssqch(["build", "--root", dir]);
	// Frozen under 0.7's name for the command, `inspect`; `ssqch trace` writes the same JSON.
	check("inspect", json(["trace", "/", "--root", dir]));
	check("inspect --field", json(["trace", "/", "--field", "title", "--root", dir]));
});

test("diff report", () => {
	const dir = site();
	ssqch(["build", "--root", dir, "--output", "before"]);
	write(dir, { "src/about.md": "---\ntitle: About us\n---\nThe stump moved.\n", "src/new.md": "New\n" });
	ssqch(["build", "--root", dir, "--output", "after"]);
	check("diff", json(["diff", path.join(dir, "before"), path.join(dir, "after")]));
});


test("diff report, several builds", () => {
	const dir = site();
	for (const out of ["one", "two", "three"]) ssqch(["build", "--root", dir, "--output", out]);
	write(dir, { "three/stray.txt": "pine\n", "two/about/index.html": "<p>The stump moved.</p>\n" });
	const r = ssqch(["diff", path.join(dir, "one"), path.join(dir, "two"), path.join(dir, "three"), "--format", "json"]);
	check("diff (several builds)", JSON.parse(r.stdout));
});
// Added in 0.12, from the fresh vuejs.org run: how much of each page's article text matches.
test("diff report, article text", () => {
	const dir = site();
	ssqch(["build", "--root", dir, "--output", "before"]);
	write(dir, { "src/about.md": "---\ntitle: About us\n---\nThe stump moved.\n" });
	ssqch(["build", "--root", dir, "--output", "after"]);
	const r = ssqch(["diff", path.join(dir, "before"), path.join(dir, "after"), "--text", "--format", "json"]);
	check("diff --text", JSON.parse(r.stdout));
});


test("footprint report", () => {
	const dir = site();
	ssqch(["build", "--root", dir]);
	check("footprint", json(["footprint", "--root", dir]));
});

// Added in 0.13: `ssqch patrol --format json`, with a warning and its files.
test("patrol report", () => {
	const dir = site();
	ssqch(["build", "--root", dir]);
	check("patrol", json(["patrol", "--root", dir]));
});

test("new report", () => {
	const dir = site();
	check("new", json(["new", "posts", "--title", "Pine cones", "--date", "2026-02-03", "--root", dir]));
});

test("capabilities report", () => {
	check("capabilities", json(["capabilities"]));
});

test("serve ready file", async () => {
	const dir = site();
	const { server, info } = await serveSite(dir);
	try {
		check("serve ready file", info);
	} finally {
		await server.stop();
	}
});

test.after(() => {
	if (freezing) fs.writeFileSync(FILE, JSON.stringify(shapes, null, 2) + "\n");
	if (freezingNew) {
		const added = Object.fromEntries(Object.entries(shapes).filter(([name]) => !frozen[name] && ADDED[name]));
		if (Object.keys(added).length) fs.writeFileSync(FILE, JSON.stringify({ ...frozen, ...added }, null, 2) + "\n");
	}
});
