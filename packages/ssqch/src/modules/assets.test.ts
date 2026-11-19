import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { blake3Hex } from "../blake3.ts";
import { BUILTINS } from "../config.ts";
import type { Config } from "../config.ts";
import { builtCopy, fingerprint, integrity, rewriteAssets } from "./assets.ts";

// From the tests in 0.7's plugins/assets/src/lib.rs.

function dir(name: string): string {
	const d = fs.mkdtempSync(path.join(os.tmpdir(), `ssqch-assets-${name}-`));
	fs.mkdirSync(path.join(d, "assets"));
	return d;
}

test("rewrites matching href and src only", () => {
	const urls = new Map([["/assets/index.css", "/assets/index.0123abcd.css"], ["/assets/index.js", "/assets/index.89ef4567.js"]]);
	const html = "<link rel=\"stylesheet\" href=\"/assets/index.css\"><link rel=\"preload\" href=\"/assets/index.js?v=2#x\"><script src=\"/assets/index.js\" defer></script><a href=\"/assets/index.css.map\">map</a><img src=\"/assets/other.png\"><p>/assets/index.css</p>";
	assert.equal(
		rewriteAssets(html, urls, new Map()),
		"<link rel=\"stylesheet\" href=\"/assets/index.0123abcd.css\"><link rel=\"preload\" href=\"/assets/index.89ef4567.js?v=2#x\"><script src=\"/assets/index.89ef4567.js\" defer></script><a href=\"/assets/index.css.map\">map</a><img src=\"/assets/other.png\"><p>/assets/index.css</p>",
	);
});

test("rewrites imports in inline module scripts", () => {
	const urls = new Map([["/assets/pco.js", "/assets/pco.0123abcd.js"]]);
	const html = "<script type=\"module\">\n import { setup } from \"/assets/pco.js\";\nimport '/assets/pco.js?v=1';\nexport { x } from \"/assets/pco.js\";\nconst m = await import( \"/assets/pco.js\" );\nimport other from \"/assets/other.js\";\nconst s = \"/assets/pco.js\";\n</script><script>import x from \"/assets/pco.js\"</script><script type=\"module\" src=\"/assets/pco.js\"></script>";
	assert.equal(
		rewriteAssets(html, urls, new Map()),
		"<script type=\"module\">\n import { setup } from \"/assets/pco.0123abcd.js\";\nimport '/assets/pco.0123abcd.js?v=1';\nexport { x } from \"/assets/pco.0123abcd.js\";\nconst m = await import( \"/assets/pco.0123abcd.js\" );\nimport other from \"/assets/other.js\";\nconst s = \"/assets/pco.js\";\n</script><script>import x from \"/assets/pco.js\"</script><script type=\"module\" src=\"/assets/pco.0123abcd.js\"></script>",
	);
});

test("integrity goes on links and scripts", () => {
	assert.equal(integrity(Buffer.from("abc")), "sha384-ywB1P0WjXou1oD1pmsZQBycsMqsO3tFjGotgWkP/W+2AhgcroefMI1i67KE0yCWn");
	const urls = new Map([["/a.css", "/a.0123abcd.css"]]);
	const sri = new Map([["/a.css", "sha384-x"]]);
	assert.equal(
		rewriteAssets("<link rel=\"stylesheet\" href=\"/a.css\"><a href=\"/a.css\">a</a><link href=\"/a.css\" integrity=\"mine\">", urls, sri),
		"<link rel=\"stylesheet\" href=\"/a.0123abcd.css\" integrity=\"sha384-x\"><a href=\"/a.0123abcd.css\">a</a><link href=\"/a.0123abcd.css\" integrity=\"mine\">",
	);
});

test("fingerprinting renames and cleans up", () => {
	const out = dir("rename");
	fs.writeFileSync(path.join(out, "assets/index.css"), "body { color: green }");
	fs.writeFileSync(path.join(out, "assets/index.00000000.css"), "old");
	fs.writeFileSync(path.join(out, "assets/index.notahash.css"), "keep");
	const url = fingerprint(out, "/assets/index.css");
	const expected = `/assets/index.${blake3Hex(Buffer.from("body { color: green }")).slice(0, 8)}.css`;
	assert.equal(url, expected);
	assert.ok(!fs.existsSync(path.join(out, "assets/index.css")), "the plain file is renamed");
	assert.ok(!fs.existsSync(path.join(out, "assets/index.00000000.css")), "older fingerprinted copies are removed");
	assert.ok(fs.existsSync(path.join(out, "assets/index.notahash.css")), "other files are left alone");
	// A second build without rebuilding the CSS reuses the fingerprinted copy.
	assert.equal(fingerprint(out, "/assets/index.css"), expected);
	fs.rmSync(out, { recursive: true });
});

test("a missing file is an error", () => {
	const out = dir("missing");
	assert.throws(() => fingerprint(out, "/assets/index.js"), /index\.js doesn't exist; build the CSS and JS before ssqch/);
	fs.rmSync(out, { recursive: true });
});

test("finds the copy a production build left", () => {
	const out = dir("copy");
	assert.equal(builtCopy(out, "/assets/index.css"), undefined);
	fs.writeFileSync(path.join(out, "assets/index.0123abcd.css"), "built");
	assert.equal(builtCopy(out, "/assets/index.css"), "/assets/index.0123abcd.css");
	// Two copies: no telling which is current.
	fs.writeFileSync(path.join(out, "assets/index.89ef4567.css"), "older");
	assert.equal(builtCopy(out, "/assets/index.css"), undefined);
	fs.rmSync(out, { recursive: true });
});

test("assetsPlugin() rewrites the pages that name a file, and assetUrl() names what it was asked", async () => {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "ssqch-assets-plugin-"));
	fs.mkdirSync(path.join(root, "dist/assets"), { recursive: true });
	fs.writeFileSync(path.join(root, "dist/assets/site.css"), "body { color: green }");
	const config = { root, input: "src", output: "dist", env: "production", serving: false, passthrough: [], renamedCopies: new Map(), beforeBuild: [], htmlTransforms: [], filters: new Map(), summaries: [] } as unknown as Config;
	await BUILTINS.get("ssqch/assets")!(config, { files: ["/assets/site.css"] } as never);
	const hook = config.beforeBuild[0] as { fn: (event: unknown) => unknown };
	await hook.fn({});
	const [[, transform]] = config.htmlTransforms;
	const info = { url: "/", inputPath: "./index.md", outputPath: path.join(root, "dist/index.html") };
	const hashed = `/assets/site.${blake3Hex(Buffer.from("body { color: green }")).slice(0, 8)}.css`;
	assert.equal(await transform("<link rel=\"stylesheet\" href=\"/assets/site.css\">", info), `<link rel="stylesheet" href="${hashed}">`);
	assert.equal(await transform("<link rel=\"stylesheet\" href=\"/other.css\">", info), "<link rel=\"stylesheet\" href=\"/other.css\">");
	const assetUrl = config.filters.get("assetUrl")!;
	assert.equal(assetUrl("/assets/site.css"), hashed);
	// Called with nothing, as 0.7 said it.
	assert.throws(() => assetUrl(), { message: "assetUrl(\"\"): not one of the assets plugin's files (/assets/site.css)" });
	assert.throws(() => assetUrl(undefined), { message: "assetUrl(\"undefined\"): not one of the assets plugin's files (/assets/site.css)" });
	fs.rmSync(root, { recursive: true });
});
