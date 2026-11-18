import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WebAssembly } from "./engines/webassembly.ts";
import { RustPlugin, compilePlugin, loadRustPart, readManifest, toJson } from "./rust-plugin.ts";

/** The example plugin (examples/rust-plugin), committed built. */
const EXAMPLE = fileURLToPath(new URL("../../../examples/rust-plugin/trail_guide.wasm", import.meta.url));

const example = (options?: unknown) => new RustPlugin(new WebAssembly.Module(fs.readFileSync(EXAMPLE)), options, "trail_guide.wasm");

// ---- a plugin made byte by byte, for what a real one shouldn't do -----------------------------

const leb = (n: number, signed = false): number[] => {
	const out: number[] = [];
	for (;;) {
		const byte = n & 0x7f;
		n = signed ? n >> 7 : n >>> 7;
		const done = signed ? (n === 0 && !(byte & 0x40)) || (n === -1 && (byte & 0x40)) : n === 0;
		out.push(done ? byte : byte | 0x80);
		if (done) return out;
	}
};
const text = (s: string) => [...leb(Buffer.byteLength(s)), ...Buffer.from(s)];
const section = (id: number, body: number[]) => [id, ...leb(body.length), ...body];
const vec = (items: number[][]) => [...leb(items.length), ...items.flat()];
const i32 = (n: number) => [0x41, ...leb(n, true)];
const store = (at: number, value: number[]) => [...i32(at), ...value, 0x36, 0x02, 0x00];

const PANIC = "panicked at src/lib.rs:7:9:\nthe trail washed out";

/**
 * An ABI v1 plugin whose transform panics (it says so in the result slot, then traps), whose
 * render traps without a word, and whose `echo` filter answers its arguments. `manifest` and
 * `imports` change it for the refusals.
 */
function handMade({ manifest = { abi: 1, name: "hand-made", version: "0.1.0", sdk: "0.8.0", hooks: ["transform", "filter", "render"], filters: ["echo"], engines: ["boom"] }, importEnv = false } = {}): Buffer {
	const SLOT = 16, MESSAGE = 64, SCRATCH = 1024;
	const types = vec([[0x60, 0, 1, 0x7f], [0x60, 1, 0x7f, 1, 0x7f], [0x60, 2, 0x7f, 0x7f, 1, 0x7f], [0x60, 3, 0x7f, 0x7f, 0x7f, 1, 0x7f]]);
	const imports = importEnv ? section(2, vec([[...text("env"), ...text("foo"), 0x00, 0x00]])) : [];
	const bodies: number[][] = [
		[...i32(1)], // ssqch_abi_v1
		[...i32(SCRATCH)], // ssqch_reserve
		[...i32(SLOT)], // ssqch_result
		[...i32(1)], // ssqch_init: fine, nothing to say
		[...store(SLOT, i32(MESSAGE)), ...store(SLOT + 4, i32(Buffer.byteLength(PANIC))), ...store(SLOT + 8, i32(1)), 0x00], // ssqch_transform: a panic
		[...store(SLOT, [...i32(SCRATCH), 0x20, 0, 0x6a]), ...store(SLOT + 4, [0x20, 1]), ...i32(0)], // ssqch_filter: the arguments back
		[...store(SLOT + 8, i32(0)), 0x00], // ssqch_render: a trap
	];
	const functionTypes = [0, 1, 0, 1, 2, 2, 3];
	const names = ["ssqch_abi_v1", "ssqch_reserve", "ssqch_result", "ssqch_init", "ssqch_transform", "ssqch_filter", "ssqch_render"];
	const offset = importEnv ? 1 : 0;
	const exports = vec([[...text("memory"), 0x02, 0], ...names.map((name, i) => [...text(name), 0x00, ...leb(i + offset)])]);
	const code = vec(bodies.map((body) => { const fn = [0, ...body, 0x0b]; return [...leb(fn.length), ...fn]; }));
	const data = vec([[0, ...i32(MESSAGE), 0x0b, ...text(PANIC)]]);
	return Buffer.from([
		0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,
		...section(1, types),
		...imports,
		...section(3, vec(functionTypes.map((t) => [t]))),
		...section(5, vec([[0, 1]])),
		...section(7, exports),
		...section(10, code),
		...section(11, data),
		...section(0, [...text("ssqch_plugin"), ...Buffer.from(JSON.stringify(manifest))]),
	]);
}

const handPlugin = (options?: unknown) => new RustPlugin(new WebAssembly.Module(handMade()), options, "hand-made.wasm");

// ---- the tests --------------------------------------------------------------------------------

test("the example plugin's hooks answer", () => {
	const guide = example({ greeting: "Howdy", wordsPerMinute: 2 });
	assert.deepEqual(guide.manifest.filters, ["readingTime", "greet", "tally"]);
	assert.deepEqual(guide.manifest.engines, ["trail"]);
	assert.equal(guide.name, "trail-guide");
	assert.equal(guide.transform("<a href=\"https://example.com\">x</a>", { url: "/" }), "<a href=\"https://example.com\" rel=\"external\">x</a>");
	assert.equal(guide.transform("<p>nothing to do</p>"), null);
	assert.equal(guide.filter("greet", ["Sasquatch"]), "Howdy, Sasquatch");
	assert.equal(guide.filter("readingTime", ["one two three"]), 2);
	assert.deepEqual(guide.filter("tally", [[{ creature: "elk" }, { creature: "Sasquatch" }, { creature: "elk" }], "creature"]), { elk: 2, Sasquatch: 1 });
	assert.equal(guide.render("trail", "0 Ranger station\n", { dataJson: JSON.stringify({ title: "Cedar Trail" }) }), "<h1>Cedar Trail</h1>\n<ol class=\"trail\">\n  <li><span class=\"miles\">0.0 mi</span> Ranger station</li>\n</ol>\n<p class=\"trail-length\">0.0 miles</p>\n");
	// A long input makes the plugin reserve more room, and a short one after it still works.
	const long = "<p>" + "pine cone ".repeat(50_000) + "</p>";
	assert.equal(guide.filter("readingTime", [long]), 50_000);
	assert.equal(guide.filter("readingTime", ["a"]), 1);
	assert.equal(guide.filter("greet", ["ranger \u{1F332}"]), "Howdy, ranger \u{1F332}");
});

test("a plugin's errors name it and what it was doing", () => {
	const guide = example();
	assert.throws(() => guide.filter("readingTime", [3]), { message: "trail-guide: filter readingTime: readingTime expects text, got a number" });
	assert.throws(() => guide.filter("nope", []), { message: "trail-guide: no filter named nope (it provides readingTime, greet, tally)" });
	assert.throws(() => guide.render("md", ""), { message: "trail-guide: doesn't render .md files (it renders .trail)" });
	assert.throws(() => guide.render("trail", "halfway Stump", { inputPath: "./src/cedar.trail" }), { message: "trail-guide: render of ./src/cedar.trail: line 1: a stop starts with its distance in miles, like \"1.2 Old Growth junction\"" });
	assert.throws(() => example({ greting: "Howdy" }), { message: "trail-guide: options: unknown field `greting`, expected one of `greeting`, `wordsPerMinute`, `externalRel`" });
	assert.throws(() => example({ wordsPerMinute: 0 }), { message: "trail-guide: wordsPerMinute must be at least 1" });
});

test("a panic is an error with its place, and the next call gets a fresh plugin", () => {
	const plugin = handPlugin();
	assert.throws(() => plugin.transform("<p>x</p>", { url: "/cedar/" }), { message: "hand-made: transform of /cedar/: panicked at src/lib.rs:7:9: the trail washed out" });
	assert.equal(plugin.filterJson("echo", "[\"after\"]"), "[\"after\"]");
	assert.throws(() => plugin.render("boom", "x", { inputPath: "./src/a.boom" }), (e: Error) => e.message.startsWith("hand-made: render of ./src/a.boom: crashed (") && e.message.includes("unreachable"));
	assert.equal(plugin.filterJson("echo", "[1,2]"), "[1,2]");
});

test("what isn't a plugin, or is for another ABI, is refused", () => {
	const future = handMade({ manifest: { abi: 2, name: "x", version: "1", sdk: "1", hooks: [], filters: [], engines: [] } });
	assert.throws(() => readManifest(new WebAssembly.Module(future), "future.wasm"), { message: "future.wasm: built for plugin ABI 2, and this ssqch loads ABI 1: update ssqch, or use a version of the plugin built for ABI 1" });
	const past = handMade({ manifest: { abi: 0, name: "x", version: "1", sdk: "1", hooks: [], filters: [], engines: [] } });
	assert.throws(() => readManifest(new WebAssembly.Module(past), "old.wasm"), { message: "old.wasm: built for plugin ABI 0, and this ssqch loads ABI 1: rebuild it with a current ssqch-plugin" });
	const empty = Buffer.from("0061736d01000000", "hex");
	assert.throws(() => new RustPlugin(new WebAssembly.Module(empty), undefined, "empty.wasm"), { message: "empty.wasm: not an ssqch plugin (it has no ssqch_plugin section; was it built with ssqch_plugin::export!?)" });
	assert.throws(() => new RustPlugin(new WebAssembly.Module(handMade({ importEnv: true })), undefined, "env.wasm"), { message: "env.wasm: it imports env.foo, which ssqch doesn't provide (plugins can use std; ssqch answers wasi_snapshot_preview1 calls without files or network)" });

	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ssqch-rust-"));
	fs.writeFileSync(path.join(dir, "pine.wasm"), "pine cones");
	assert.throws(() => compilePlugin(path.join(dir, "pine.wasm"), "./pine.wasm"), (e: Error) => e.message.startsWith("./pine.wasm: not an ssqch plugin (it isn't WebAssembly: expected magic word 00 61 73 6d"));
	assert.throws(() => compilePlugin(path.join(dir, "nope.wasm"), "./nope.wasm"), { message: "./nope.wasm doesn't exist" });
	assert.throws(() => compilePlugin(dir, "./dir"), { message: "./dir isn't a file" });
});

test("a config's rust part is checked, and its hooks made", () => {
	const where = "plugin \"trail-guide\"";
	assert.throws(() => loadRustPart("x.wasm", where, "/"), { message: `${where}: rust must be an object, like { wasm: "/path/to/plugin.wasm", options: {} }` });
	assert.throws(() => loadRustPart({ wasm: EXAMPLE, option: {} }, where, "/"), { message: `${where}: rust.option isn't an option (options: wasm, options)` });
	assert.throws(() => loadRustPart({ options: {} }, where, "/"), { message: `${where}: rust.wasm must be the path to the plugin's .wasm file` });
	assert.throws(() => loadRustPart({ wasm: EXAMPLE, options: { greting: "x" } }, where, "/"), (e: Error) => e.message.startsWith(`${where}: options: unknown field \`greting\``));
	assert.throws(() => loadRustPart({ wasm: EXAMPLE, options: { greting: "x" } }, "plugins[0]", "/"), (e: Error) => e.message.startsWith("plugins[0]: trail-guide: options: unknown field"));

	const part = loadRustPart({ wasm: new URL("../../../examples/rust-plugin/trail_guide.wasm", import.meta.url).href }, where, "/");
	const [name, transform] = part.transform!;
	assert.equal(name, "trail-guide");
	const link = "<a href=\"https://example.com\">x</a>";
	// HTML pages only.
	assert.equal(transform(link, { url: "/", inputPath: "./src/index.md", outputPath: "/site/_site/index.html" }), "<a href=\"https://example.com\" rel=\"external\">x</a>");
	assert.equal(transform(link, { url: "/feed.xml", inputPath: "./src/feed.njk", outputPath: "/site/_site/feed.xml" }), link);
	assert.deepEqual(part.filters.map(([n]) => n), ["readingTime", "greet", "tally"]);
	const readingTime = part.filters[0][1];
	assert.throws(() => readingTime(3), { message: "trail-guide: readingTime expects text, got a number" });
	const [ext, render] = part.engines[0];
	assert.equal(ext, "trail");
	assert.throws(() => render("halfway", { page: { url: "/cedar/" } }, "cedar.trail"), { message: "trail-guide: cedar.trail:1: a stop starts with its distance in miles, like \"1.2 Old Growth junction\"" });
	// The page's data, without the collections.
	const data = { title: "Old Growth", page: { url: "/old/" }, collections: { get all(): never { throw new Error("collections read"); } } };
	assert.ok(render("1 Stump", data, "old.trail").startsWith("<h1>Old Growth</h1>"));
});

test("values go to a plugin as JSON, without reading getters", () => {
	let read = false;
	const item = { title: "Cedar", get templateContent() { read = true; return "<p>body</p>"; } };
	const cycle: Record<string, unknown> = { name: "loop" };
	cycle.self = cycle;
	const shared = { kind: "pine cone" };
	assert.equal(toJson([item, new Date(Date.UTC(2026, 2, 14)), undefined, () => 1, 12n, cycle, { a: shared, b: shared }]), "[{\"title\":\"Cedar\"},\"2026-03-14T00:00:00.000Z\",null,null,\"12\",{\"name\":\"loop\",\"self\":null},{\"a\":{\"kind\":\"pine cone\"},\"b\":{\"kind\":\"pine cone\"}}]");
	assert.equal(read, false);
	assert.equal(toJson({ a: 1, collections: { all: [] } }, "collections"), "{\"a\":1}");
	assert.equal(toJson(undefined), "null");
});
