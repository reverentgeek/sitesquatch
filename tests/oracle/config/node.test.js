// From crates/sitesquatch-js/tests/node.rs.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { ssqch, project, read, write, FIXTURES, RUST_07 } from "../lib/ssqch.js";

// The Rust tests built "a site without ssqch.config.js" through the library, whose default
// template formats include edge. The command line's don't, so each project gets this config, which
// does nothing else: JavaScript data files load the same.
const EDGE_ONLY = { "ssqch.config.js": "export default { templateFormats: [\"edge\"] };\n" };

/** Builds `root` the way the Rust tests did: production, quiet. */
function build(root, extra = []) {
	return ssqch(["build", "--root", root, "--quiet", ...extra]);
}

function buildOk(root, extra) {
	const r = build(root, extra);
	assert.ok(r.ok, r.log);
	return r;
}

function json(root, file) {
	try {
		return JSON.parse(read(root, file));
	} catch (e) {
		throw new Error(`${file}: ${e.message}`);
	}
}

/** The error text of a build of `files` that must fail (the binary's `error: ` prefix removed). */
function buildError(files) {
	const root = project({ ...EDGE_ONLY, ...files });
	const r = build(root);
	assert.ok(!r.ok, `expected an error, but the build worked:\n${r.log}`);
	return r.log.replace(/^error: /, "");
}

const fixture = (name) => fs.readFileSync(path.join(FIXTURES, "js", name), "utf8");

test("data_files_can_be_values_functions_or_async", () => {
	const root = project({
		...EDGE_ONLY,
		"_data/plain.js": "export default { snack: \"Pine Cone Crunch\" };",
		"_data/fn.js": "export default () => [1, 2, 3];",
		"_data/later.mjs": "export default async function () { await null; return \"async\"; }",
		"_data/nested/deep.js": "export default \"deep\";",
		"_data/site.json": "{ \"title\": \"Squatch\" }",
		"index.edge": "{{ plain.snack }}|{{ fn.join(\",\") }}|{{ later }}|{{ nested.deep }}|{{ site.title }}",
	});
	buildOk(root);
	assert.equal(read(root, "_site/index.html"), "Pine Cone Crunch|1,2,3|async|deep|Squatch");
});

test("template_and_directory_data_files_with_computed_functions", () => {
	const root = project({
		...EDGE_ONLY,
		"posts/posts.data.js":
			"export default { tags: \"posts\", from: \"directory\", computed: { shout: (data) => data.title.toUpperCase() + \"!\", permalink: (data) => `/snacks/${data.page.fileSlug}/` } };",
		"posts/hello.data.js": "export default () => ({ from: \"template\" });",
		"posts/hello.edge": "---\ntitle: hello forest\n---\n{{ shout }}|{{ from }}|{{ tags }}",
		// A plain `.js` next to templates is a script, not data.
		"posts/posts.js": "throw new Error(\"not data\");",
	});
	buildOk(root);
	assert.equal(read(root, "_site/snacks/hello/index.html"), "HELLO FOREST!|template|posts");
});

// The Rust test builds twice with one Config in one process (development), and the second build
// has to see the changed file. Through the command line each build is a new process.
test("changed_data_files_reload_between_builds", () => {
	const root = project({ ...EDGE_ONLY, "_data/snacks.js": "export default [\"Pine Cone Crunch\"];", "index.edge": "{{ snacks.join(\", \") }}" });
	buildOk(root, ["--env", "development"]);
	assert.equal(read(root, "_site/index.html"), "Pine Cone Crunch");

	const file = path.join(root, "_data/snacks.js");
	fs.writeFileSync(file, "export default [\"Yeti Yogurt\"];");
	// Make sure the modification time moves even on coarse-grained file systems.
	const later = new Date(fs.statSync(file).mtimeMs + 2000);
	fs.utimesSync(file, later, later);
	buildOk(root, ["--env", "development"]);
	assert.equal(read(root, "_site/index.html"), "Yeti Yogurt");
});

// DELIBERATE (0.8): `node:path` is Node's own, which on Windows is Windows' (`a\b`, `C:\a`). 0.7's
// was the POSIX one on every system, and the expected values are POSIX Node's.
test("path_matches_node", { skip: !RUST_07 && process.platform === "win32" && "0.8 on Windows: node:path is Windows' own, as in Node" }, () => {
	const root = project({
		...EDGE_ONLY,
		"_data/out.mjs": fixture("path-cases.mjs"),
		"index.edge": "{{{ JSON.stringify(out) }}}",
	});
	buildOk(root);
	const expected = JSON.parse(fixture("path-expected.json"));
	const got = json(root, "_site/index.html");
	const mismatches = [];
	for (const [key, cases] of Object.entries(expected)) {
		cases.forEach((want, i) => {
			const have = got[key]?.[i];
			if (JSON.stringify(have) !== JSON.stringify(want)) mismatches.push(`${key}[${i}]: node ${JSON.stringify(want)} vs ${JSON.stringify(have)}`);
		});
	}
	assert.ok(mismatches.length === 0, mismatches.join("\n"));
});

const FS_CHECKS = `
import fs, { readFileSync, existsSync } from "node:fs";
import { readFile, writeFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import process from "node:process";

const here = path.dirname(fileURLToPath(import.meta.url));
const code = (fn) => { try { fn(); return "no error"; } catch (e) { return e.code; } };

export default async function () {
  fs.mkdirSync("tmp/a/b", { recursive: true });
  fs.writeFileSync("tmp/a/b/snack.txt", "Pine Cone Crunch");
  fs.appendFileSync("tmp/a/b/snack.txt", " & Bigfoot Brittle");
  await writeFile("tmp/bytes.bin", Buffer.from([0, 1, 254, 255]));
  fs.copyFileSync("tmp/a/b/snack.txt", "tmp/copy.txt");
  fs.renameSync("tmp/copy.txt", "tmp/moved.txt");
  const result = {
    here: path.relative(process.cwd(), here),
    text: readFileSync("tmp/a/b/snack.txt", "utf8"),
    viaPromise: await readFile("tmp/moved.txt", { encoding: "utf8" }),
    bufferText: String(readFileSync("tmp/moved.txt")),
    bytes: Array.from(readFileSync("tmp/bytes.bin")),
    isBuffer: Buffer.isBuffer(readFileSync("tmp/bytes.bin")),
    listing: await readdir("tmp"),
    dirents: fs.readdirSync("tmp", { withFileTypes: true }).map((d) => \`\${d.name}:\${d.isDirectory() ? "dir" : "file"}\`),
    size: fs.statSync("tmp/bytes.bin").size,
    mtimeIsDate: fs.statSync("tmp/bytes.bin").mtime instanceof Date,
    exists: [existsSync("tmp/moved.txt"), existsSync("tmp/nope")],
    missing: code(() => readFileSync("tmp/nope")),
    notEmpty: code(() => fs.rmSync("tmp/a")),
    forced: code(() => fs.rmSync("tmp/nope", { force: true })),
    fileUrl: pathToFileURL("tmp/a b.txt").href.endsWith("/tmp/a%20b.txt"),
    urlPath: fileURLToPath(pathToFileURL("tmp/x.txt")) === path.resolve("tmp/x.txt"),
    base64: Buffer.from("Sasquatch").toString("base64"),
    fromBase64: Buffer.from("U2FzcXVhdGNo", "base64").toString(),
    hex: Buffer.from("squatch").toString("hex"),
    utf8Length: Buffer.byteLength("🦶"),
    slice: Buffer.from("bigfoot").subarray(3).toString(),
    concat: Buffer.concat([Buffer.from("big"), Buffer.from("foot")]).toString(),
    json: JSON.stringify(Buffer.from("hi")),
  };
  fs.rmSync("tmp", { recursive: true });
  result.cleanedUp = !existsSync("tmp");
  return result;
}
`;

test("fs_buffer_and_url_behave_like_node", () => {
	const root = project({ ...EDGE_ONLY, "_data/checks.js": FS_CHECKS, "index.edge": "{{{ JSON.stringify(checks) }}}" });
	buildOk(root);
	const got = json(root, "_site/index.html");
	// What Node 24 returns for the same file.
	const expected = {
		here: "_data",
		text: "Pine Cone Crunch & Bigfoot Brittle",
		viaPromise: "Pine Cone Crunch & Bigfoot Brittle",
		bufferText: "Pine Cone Crunch & Bigfoot Brittle",
		bytes: [0, 1, 254, 255],
		isBuffer: true,
		listing: ["a", "bytes.bin", "moved.txt"],
		dirents: ["a:dir", "bytes.bin:file", "moved.txt:file"],
		size: 4,
		mtimeIsDate: true,
		exists: [true, false],
		missing: "ENOENT",
		notEmpty: "ERR_FS_EISDIR",
		forced: "no error",
		fileUrl: true,
		urlPath: true,
		base64: "U2FzcXVhdGNo",
		fromBase64: "Sasquatch",
		hex: "73717561746368",
		utf8Length: 4,
		slice: "foot",
		concat: "bigfoot",
		json: "{\"type\":\"Buffer\",\"data\":[104,105]}",
		cleanedUp: true,
	};
	assert.deepEqual(got, expected);
});

test("relative_fs_paths_resolve_against_the_project_root", () => {
	// The build's root isn't the process's working directory here, like
	// `ssqch build --root some/site`.
	const root = project({
		...EDGE_ONLY,
		"notes.txt": "from the project root",
		"_data/notes.js": "import fs from \"node:fs\"; export default fs.readFileSync(\"notes.txt\", \"utf8\");",
		"index.edge": "{{ notes }}",
	});
	assert.notEqual(process.cwd(), root);
	buildOk(root);
	assert.equal(read(root, "_site/index.html"), "from the project root");
});

test("data_file_errors_name_the_file", () => {
	let e = buildError({ "_data/x.js": "export const snacks = [];", "index.edge": "" });
	assert.ok(e.includes("_data/x.js: a data file needs a default export"), e);

	e = buildError({ "_data/x.js": "export default async () => { await null; throw new TypeError(\"bad snack\"); };", "index.edge": "" });
	assert.ok(e.includes("_data/x.js: bad snack") && e.includes("at default (_data/x.js:1:"), e);

	e = buildError({ "_data/x.js": "import fs from \"node:fs\"; export default fs.readFileSync(\"nope.json\", \"utf8\");", "index.edge": "" });
	// DELIBERATE (0.8): the message is Node's own, and on Windows Node names the whole path.
	if (RUST_07 || process.platform !== "win32") assert.ok(e.includes("ENOENT: no such file or directory, open 'nope.json'"), e);
	else assert.ok(e.includes("ENOENT: no such file or directory, open '") && e.includes("nope.json'"), e);
});

test("data_file_errors_name_the_file (node:sqlite)", { skip: !RUST_07 && "QuickJS only: the list of node: modules ssqch shims" }, () => {
	const e = buildError({ "_data/x.js": "import s from \"node:sqlite\"; export default 1;", "index.edge": "" });
	assert.ok(e.includes("node:sqlite isn't available in ssqch (available: node:fs"), e);
});

test("intl_dates_and_numbers_match_node", () => {
	const root = project({
		...EDGE_ONLY,
		"_data/out.mjs": fixture("intl-cases.mjs"),
		"index.edge": "{{{ JSON.stringify(out) }}}",
	});
	buildOk(root);
	const expected = JSON.parse(fixture("intl-expected.json"));
	const got = json(root, "_site/index.html");
	const mismatches = [];
	for (const [key, cases] of Object.entries(expected)) {
		cases.forEach((want, i) => {
			if (JSON.stringify(got[key]?.[i]) !== JSON.stringify(want)) mismatches.push(`${key}[${i}]: node ${JSON.stringify(want)} vs ${JSON.stringify(got[key]?.[i])}`);
		});
	}
	assert.ok(mismatches.length === 0, mismatches.join("\n"));
});

test("collation_matches_node", () => {
	const root = project({ ...EDGE_ONLY, "_data/out.mjs": fixture("collation-cases.mjs"), "index.edge": "{{ out.join(\"\\n\") }}" });
	buildOk(root);
	const got = read(root, "_site/index.html");
	assert.equal(got.trimEnd(), fixture("collation-expected.txt").trimEnd());
});

test("intl_refuses_what_it_cant_format", { skip: !RUST_07 && "QuickJS only: ssqch 0.7's Intl only formats en-US, UTC or local time and plain numbers" }, () => {
	let e = buildError({ "_data/x.js": "export default new Date(0).toLocaleDateString(\"de-DE\");", "index.edge": "" });
	assert.ok(e.includes("only \"en-US\" formatting is available in ssqch (got \"de-DE\")"), e);
	e = buildError({ "_data/x.js": "export default new Date(0).toLocaleDateString(\"en-US\", { timeZone: \"America/Chicago\" });", "index.edge": "" });
	assert.ok(e.includes("only the UTC and local time zones are available in ssqch"), e);
	e = buildError({ "_data/x.js": "export default (1).toLocaleString(\"en-US\", { style: \"currency\", currency: \"USD\" });", "index.edge": "" });
	assert.ok(e.includes("the \"style\" option isn't supported in ssqch"), e);
});

test("programs_can_add_modules_with_native_functions", { skip: "needs the Rust API: a JsModule with native functions (sitesquatch_js::JsModule) added by a Rust program" }, () => {});

test("crypto_create_hash_matches_node", () => {
	// Expected values are Node's: crypto.createHash(alg).update("hello").digest("hex"), etc.
	const root = project({
		...EDGE_ONLY,
		"_data/hashes.js": `import crypto, { createHash } from "node:crypto";
import plain from "crypto";
const hex = (alg) => createHash(alg).update("hello").digest("hex");
export default {
  md5: hex("md5"),
  sha1: hex("sha1"),
  sha256: hex("sha256"),
  sha512Length: createHash("SHA512").update("hello").digest().length,
  chunked: createHash("sha256").update("hel").update(Buffer.from("lo")).digest("hex") === hex("sha256"),
  base64: createHash("sha256").update("68656c6c6f", "hex").digest("base64"),
  base64url: createHash("sha1").update("hello").digest("base64url"),
  sameModule: plain.createHash === crypto.createHash,
  hashes: crypto.getHashes().join(","),
};`,
		"index.edge":
			"{{ hashes.md5 }}\n{{ hashes.sha1 }}\n{{ hashes.sha256 }}\n{{ hashes.sha512Length }}\n{{ hashes.chunked }}\n{{ hashes.base64 }}\n{{ hashes.base64url }}\n{{ hashes.sameModule }}\n{{ hashes.hashes }}",
	});
	buildOk(root);
	const html = read(root, "_site/index.html");
	const lines = html.split("\n");
	assert.equal(lines[0], "5d41402abc4b2a76b9719d911017c592");
	assert.equal(lines[1], "aaf4c61ddcc5e8a2dabede0f3b482cd9aea9434d");
	assert.equal(lines[2], "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824");
	assert.equal(lines[3], "64");
	assert.equal(lines[4], "true", "update() can be called in pieces, with strings or Buffers");
	assert.equal(lines[5], "LPJNul+wow4m6DsqxbninhsWHlwfp0JecwQzYpOLmCQ=");
	assert.equal(lines[6], "qvTGHdzF6KLavt4PO0gs2a6pQ00");
	assert.equal(lines[7], "true");
	// QuickJS only: ssqch 0.7 lists just the five digests it supports; Node lists many more.
	if (RUST_07) assert.equal(lines[8], "md5,sha1,sha256,sha384,sha512");

	let e;
	if (RUST_07) {
		// QuickJS only: ssqch 0.7's own wording for a digest it doesn't have.
		e = buildError({ "_data/x.js": "import { createHash } from \"node:crypto\"; export default createHash(\"whirlpool\");", "index.edge": "" });
		assert.ok(e.includes("Digest method not supported: whirlpool (ssqch supports md5, sha1, sha256, sha384, sha512)"), e);
	}
	e = buildError({ "_data/x.js": "import { createHash } from \"node:crypto\"; const h = createHash(\"md5\"); h.digest(); export default h.digest();", "index.edge": "" });
	assert.ok(e.includes("Digest already called"), e);
});
