// From crates/sitesquatch-js/tests/packages.rs.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { ssqch, project, read, hasCapability, RUST_07 } from "../lib/ssqch.js";

// The Rust tests built through the library, whose default template formats include edge. The
// command line's don't, so a project without an ssqch.config.js gets this one, which does nothing
// else: JavaScript data files load the same.
const EDGE_ONLY = "export default { templateFormats: [\"edge\"] };\n";

/** Builds `root` the way the Rust tests did: production, quiet. */
function build(root, { env, extra = [] } = {}) {
	return ssqch(["build", "--root", root, "--quiet", ...extra], { env });
}

function buildOk(root, options) {
	const r = build(root, options);
	assert.ok(r.ok, r.log);
	return r;
}

/** A project of `files`, with the edge-only config unless there is a config. */
function site(files) {
	return project({ ...(files["ssqch.config.js"] === undefined ? { "ssqch.config.js": EDGE_ONLY } : {}), ...files });
}

/** The error text of a build of `files` that must fail (the binary's `error: ` prefix removed). */
function buildError(files) {
	const r = build(site(files));
	assert.ok(!r.ok, `expected an error, but the build worked:\n${r.log}`);
	return r.log.replace(/^error: /, "");
}

/**
 * A package with conditional exports, subpath patterns, `imports`, and a
 * CommonJS dependency of its own.
 */
const PACKAGES = {
	"node_modules/dual/package.json":
		`{ "name": "dual", "type": "module", "exports": { ".": { "import": "./esm/index.js", "require": "./cjs/index.cjs" }, "./tools/*": "./esm/tools/*.js", "./package.json": "./package.json" }, "imports": { "#helper": "./esm/helper.js" } }`,
	"node_modules/dual/esm/index.js": "import helper from \"#helper\";\nexport const kind = \"esm\";\nexport default () => helper();\n",
	"node_modules/dual/esm/helper.js": "import legacy from \"legacy\";\nexport default () => `helped ${legacy.name}`;\n",
	"node_modules/dual/esm/tools/shout.js": "export default s => s.toUpperCase();\n",
	"node_modules/dual/cjs/index.cjs": "exports.kind = \"cjs\";\n",
	// Old-style CommonJS: `main` without an extension, a folder require, JSON.
	"node_modules/legacy/package.json": `{ "name": "legacy", "version": "1.2.3", "main": "lib/main" }`,
	"node_modules/legacy/lib/main.js": "const util = require(\"./util\");\nconst pkg = require(\"../package.json\");\nmodule.exports = { name: \"legacy\", version: pkg.version, twice: util.twice, dir: __dirname.endsWith(\"/legacy/lib\"), file: __filename.endsWith(\"/legacy/lib/main.js\") };\n",
	"node_modules/legacy/lib/util/index.js": "exports.twice = n => n * 2;\n",
	"node_modules/@squatch/cjs-fn/package.json": `{ "name": "@squatch/cjs-fn", "exports": "./index.js" }`,
	"node_modules/@squatch/cjs-fn/index.js": "function slug(s) { return s.toLowerCase().replace(/\\s+/g, \"-\"); }\nslug.extend = () => {};\nmodule.exports = slug;\n",
};

const withPackages = (files) => ({ ...PACKAGES, ...files });

test("packages_resolve_like_node", () => {
	// DELIBERATE (0.8): 0.7 runs a CommonJS file to see its exports, so any property of
	// `module.exports` can be imported by name. Node reads the names from the source, and finds
	// none in `module.exports = { name: "legacy", ... }`: the default export has them.
	const legacy = RUST_07 ? "import legacy, { twice } from \"legacy\";" : "import legacy from \"legacy\";\nconst { twice } = legacy;";
	const root = site(withPackages({
		"_data/out.js":
			"import run, { kind } from \"dual\";\nimport shout from \"dual/tools/shout\";\n" + legacy + "\nimport slug from \"@squatch/cjs-fn\";\nimport { createRequire } from \"node:module\";\nconst require = createRequire(import.meta.url);\nexport default [run(), kind, require(\"dual\").kind, shout(\"hi\"), legacy.version, twice(4), legacy.dir, legacy.file, slug(\"Pine Cone\"), typeof slug.extend, require(\"dual/package.json\").name].join(\"|\");\n",
		"index.edge": "{{ out }}",
	}));
	buildOk(root);
	assert.equal(read(root, "_site/index.html"), "helped legacy|esm|cjs|HI|1.2.3|8|true|true|pine-cone|function|dual");
});

test("packages_resolve_from_a_parent_folder", () => {
	// A site in a monorepo, with node_modules above it.
	const root = project({
		...PACKAGES,
		"site/ssqch.config.js": EDGE_ONLY,
		"site/_data/out.js": "import legacy from \"legacy\"; export default legacy.version;",
		"site/index.edge": "{{ out }}",
	});
	const dir = path.join(root, "site");
	buildOk(dir);
	assert.equal(read(dir, "_site/index.html"), "1.2.3");
});

test("symlinked_packages_resolve_their_own_dependencies", { skip: process.platform === "win32" && "unix only: symbolic links" }, () => {
	// pnpm's layout: node_modules/a links into .pnpm, where a's own
	// dependencies sit next to it.
	const root = site({
		"node_modules/.pnpm/a@1/node_modules/a/package.json": `{ "name": "a", "main": "index.js" }`,
		"node_modules/.pnpm/a@1/node_modules/a/index.js": "module.exports = \"a+\" + require(\"b\");",
		"node_modules/.pnpm/a@1/node_modules/b/index.js": "module.exports = \"b\";",
		"_data/out.js": "import a from \"a\"; export default a;",
		"index.edge": "{{ out }}",
	});
	fs.symlinkSync(path.join(root, "node_modules/.pnpm/a@1/node_modules/a"), path.join(root, "node_modules/a"));
	buildOk(root);
	assert.equal(read(root, "_site/index.html"), "a+b");
});

test("commonjs_data_files_and_configs", () => {
	const root = site(withPackages({
		// The site's own `.js` files are CommonJS unless they use `import` or `export`.
		"_data/site.js": "const { twice } = require(\"legacy\");\nmodule.exports = { title: \"Squatch\", n: twice(21) };\n",
		"_data/later.js": "module.exports = async () => \"async cjs\";\n",
		"_data/types.cjs": "exports.kind = typeof module + typeof exports + typeof require;\n",
		// Top-level `await` alone makes an ES module, as in Node.
		"lib/setup.js": "const value = await Promise.resolve(\"waited\");\nglobalThis.waited = value;\n",
		"lib/filters.cjs": "module.exports = { shout: s => s.toUpperCase() + \"!\" };\n",
		// A cycle, finished the way Node finishes it.
		"lib/a.js": "exports.early = \"a\";\nconst b = require(\"./b\");\nexports.both = b.fromA + \"+b\";\n",
		"lib/b.js": "exports.fromA = require(\"./a\").early;\n",
		"ssqch.config.js": "import \"./lib/setup.js\";\nimport filters from \"./lib/filters.cjs\";\nimport { createRequire } from \"node:module\";\nconst require = createRequire(import.meta.url);\nexport default { templateFormats: [\"edge\"], filters: { ...filters, cycle: () => require(\"./lib/a.js\").both, waitedFor: () => globalThis.waited } };\n",
		"index.edge": "{{ site.title }} {{ site.n }} {{ later }} {{ types.kind }} {{ shout(\"hi\") }} {{ cycle() }} {{ waitedFor() }}",
	}));
	buildOk(root);
	assert.equal(read(root, "_site/index.html"), "Squatch 42 async cjs objectobjectfunction HI! a+b waited");
});

test("node_built_ins_for_packages", () => {
	const root = site({
		"_data/out.js": `import { EventEmitter } from "node:events";
import util from "node:util";
import assert from "node:assert";
import os from "node:os";
import http from "node:http";
import { setTimeout as sleep } from "node:timers/promises";

// ES5-style inheritance, as older packages do it.
function Squatch() { EventEmitter.call(this); }
util.inherits(Squatch, EventEmitter);
const s = new Squatch();
const heard = [];
s.on("snack", x => heard.push(x));
s.once("snack", x => heard.push("once " + x));
s.emit("snack", "berries");
s.emit("snack", "cones");
assert.deepStrictEqual(heard, ["berries", "once berries", "cones"]);
let threw = false;
try { assert.strictEqual(1, 2); } catch (e) { threw = e.code === "ERR_ASSERTION"; }
await sleep(5);
export default [
  heard.length,
  util.format("%s has %d snacks %j", "Squatch", 3, { a: 1 }),
  util.inspect({ a: [1, { b: "c" }] }),
  threw,
  typeof os.EOL,
  typeof http.request,
  await util.promisify((x, cb) => cb(null, x * 2))(21),
  new TextDecoder().decode(new TextEncoder().encode("✓")),
  typeof globalThis.global,
].join("|");
`,
		"index.edge": "{{{ out }}}",
	});
	buildOk(root);
	assert.equal(read(root, "_site/index.html"), "3|Squatch has 3 snacks {\"a\":1}|{ a: [ 1, { b: 'c' } ] }|true|string|function|42|✓|object");
});

test("stub_built_ins_load_but_throw_when_used", { skip: !RUST_07 && "QuickJS only: node:http is a stub that throws when used" }, () => {
	const e = buildError({ "_data/x.js": "const http = require(\"http\");\nmodule.exports = http.get(\"http://localhost\");\n", "index.edge": "" });
	assert.ok(e.includes("_data/x.js") && e.includes("node:http isn't available in ssqch"), e);
});

test("package_errors_say_what_to_fix", () => {
	let e = buildError(withPackages({ "_data/x.js": "import x from \"dual/secret\"; export default x;", "index.edge": "" }));
	assert.ok(e.includes("package \"dual\" doesn't export \"./secret\" for import (see the \"exports\" in its package.json)"), e);

	e = buildError({ "_data/x.js": "module.exports = require(\"left-pad\");", "index.edge": "" });
	assert.ok(e.includes("_data/x.js") && e.includes("Cannot find module 'left-pad' from '_data/x.js': package \"left-pad\" isn't installed"), e);

	e = buildError({
		"node_modules/boom/index.js": "exports.go = () => {\n  throw new Error(\"pine cones ran out\");\n};\n",
		"_data/x.js": "const { go } = require(\"boom\");\nmodule.exports = go();\n",
		"index.edge": "",
	});
	assert.ok(e.includes("pine cones ran out") && e.includes("(node_modules/boom/index.js:2:"), e);
	assert.ok(!e.includes("<ssqch>") && !e.includes("at call (native)"), `internal frames should be hidden: ${e}`);
});

test("timers_run_while_a_promise_waits", () => {
	const root = site({
		"_data/out.js": `const order = [];
setTimeout(() => order.push("b"), 20);
setTimeout(() => order.push("a"), 10);
const cleared = setTimeout(() => order.push("never"), 5);
clearTimeout(cleared);
let ticks = 0;
const interval = setInterval(() => { if (++ticks === 3) clearInterval(interval); }, 1);
setImmediate(() => order.push("now"));
const started = Date.now();
await new Promise(resolve => setTimeout(resolve, 30));
export default \`\${order.join(",")} \${ticks} \${Date.now() - started >= 25}\`;
`,
		"index.edge": "{{ out }}",
	});
	buildOk(root);
	assert.equal(read(root, "_site/index.html"), "now,a,b 3 true");

	// An unref'd timer doesn't keep anything waiting, as in Node.
	const e = buildError({ "_data/x.js": "export default await new Promise(r => setTimeout(r, 10).unref());", "index.edge": "" });
	assert.ok(e.includes("_data/x.js: a Promise never settled"), e);
});

test("urls_follow_the_whatwg_standard", () => {
	const root = site({
		"_data/out.js": `const u = new URL("../a/b?x=1&y=two%20words#h", "https://Example.COM:443/docs/page/");
u.searchParams.append("z", "ü");
u.hash = "";
const p = new URLSearchParams([["q", "a b&c"], ["q", "2"]]);
export default [u.href, u.host, u.origin, u.searchParams.get("y"), p.toString(), p.getAll("q").length, URL.canParse("nope"), new URL("file:///a/b c").pathname].join("|");
`,
		"index.edge": "{{{ out }}}",
	});
	buildOk(root);
	assert.equal(read(root, "_site/index.html"), "https://example.com/docs/a/b?x=1&y=two+words&z=%C3%BC|example.com|https://example.com|two words|q=a+b%26c&q=2|2|false|/a/b%20c");
});

/**
 * A tiny HTTP server for `fetch`, in a separate process (ssqch runs synchronously here, which would
 * block a server in this one): answers each request by path until `stop()`.
 */
const SERVER = `
const http = require("http");
let count = 0, flaky = 0;
http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    const p = req.url;
    const header = (n) => req.headers[n] ?? "";
    let status = 404, extra = {}, text = "nope";
    if (p === "/data.json") { status = 200; extra = { "content-type": "application/json" }; text = '{"snacks":["pine cones","berries"]}'; }
    else if (p === "/echo") { status = 201; extra = { "set-cookie": ["a=1", "b=2"] }; text = req.method + " " + body + " " + header("content-type") + " " + header("x-squatch"); }
    else if (p === "/moved") { status = 301; extra = { location: "/data.json" }; text = ""; }
    // A different answer each time, to tell a request from a saved copy.
    else if (p.startsWith("/count")) { status = 200; extra = { "set-cookie": "a=1" }; text = String(++count); }
    // Works once, then fails.
    else if (p === "/flaky") { if (flaky++ === 0) { status = 200; text = "fine"; } else { status = 503; text = "down"; } }
    else if (p.startsWith("/slow")) { setTimeout(() => { res.writeHead(200, { "content-length": 4, connection: "close" }); res.end("slow"); }, 300); return; }
    res.writeHead(status, { ...extra, "content-length": Buffer.byteLength(text), connection: "close" });
    res.end(text);
  });
}).listen(0, "127.0.0.1", function () { console.log("PORT " + this.address().port); });
`;

async function serve() {
	const child = spawn(process.execPath, ["-e", SERVER], { stdio: ["ignore", "pipe", "inherit"] });
	const base = await new Promise((resolve, reject) => {
		let out = "";
		child.stdout.on("data", (d) => {
			out += d;
			const m = /PORT (\d+)/.exec(out);
			if (m) resolve(`http://127.0.0.1:${m[1]}`);
		});
		child.on("error", reject);
		child.on("exit", () => reject(new Error("the test server stopped")));
	});
	return { base, stop: () => child.kill() };
}

const FETCH = { skip: !hasCapability("fetch") && "needs the fetch feature" };

test("fetch_makes_requests", FETCH, async () => {
	const { base, stop } = await serve();
	try {
		const data = `const base = "${base}";
const out = [];
const r = await fetch(\`\${base}/data.json\`);
out.push(\`\${r.status} \${r.ok} \${r.headers.get("content-type")} \${(await r.json()).snacks.join("+")}\`);
const e = await fetch(new URL("/echo", base), { method: "post", body: JSON.stringify({ a: 1 }), headers: { "Content-Type": "application/json", "X-Squatch": "yes" } });
out.push(\`\${e.status} \${await e.text()} \${e.headers.getSetCookie().join(";")}\`);
const started = Date.now();
const many = await Promise.all([1, 2, 3, 4].map(i => fetch(\`\${base}/slow?\${i}\`).then(r => r.text())));
out.push(\`\${many.join(",")} \${Date.now() - started < 1100 ? "parallel" : "one at a time"}\`);
const moved = await fetch(\`\${base}/moved\`);
out.push(\`\${moved.status} \${moved.redirected} \${moved.url.endsWith("/data.json")}\`);
const manual = await fetch(\`\${base}/moved\`, { redirect: "manual" });
out.push(\`\${manual.status} \${manual.headers.get("location")}\`);
const missing = await fetch(\`\${base}/missing\`);
out.push(\`\${missing.status} \${missing.ok} \${missing.bodyUsed} \${await missing.text()} \${missing.bodyUsed}\`);
try { await fetch(\`\${base}/slow\`, { signal: AbortSignal.timeout(50) }); out.push("no timeout"); } catch (err) { out.push(err.name); }
try { await fetch("file:///etc/hosts"); } catch (err) { out.push(err.message); }
export default out.join("\\n");
`;
		const root = site({ "_data/out.js": data, "index.edge": "{{{ out }}}" });
		buildOk(root); // the server runs in another process, so a blocking build is fine
		const got = read(root, "_site/index.html");
		assert.deepEqual(got.split("\n"), [
			"200 true application/json pine cones+berries",
			"201 POST {\"a\":1} application/json yes a=1;b=2",
			"slow,slow,slow,slow parallel",
			"200 true true",
			"301 /data.json",
			"404 false false nope true",
			"TimeoutError",
			"fetch failed: file:///etc/hosts: only http: and https: URLs can be fetched",
		]);
	} finally {
		stop();
	}
});

test("fetch_errors_reject_with_type_errors", FETCH, () => {
	// Nothing listens on port 9 here (the discard port), or it refuses.
	const root = site({ "_data/out.js": "try { await fetch(\"http://127.0.0.1:9/\"); } catch (e) { var out = `${e.name}: ${e.message.startsWith(\"fetch failed: http://127.0.0.1:9/\")}`; }\nexport default out;", "index.edge": "{{ out }}" });
	buildOk(root);
	assert.equal(read(root, "_site/index.html"), "TypeError: true");
});

// The Rust test builds twice with one Config in one process (development), and the second build
// has to see the changed file. Through the command line each build is a new process.
test("changed_commonjs_data_files_reload_between_builds", () => {
	const root = site({ "_data/snacks.js": "module.exports = [\"Pine Cone Crunch\"];", "index.edge": "{{ snacks.join(\", \") }}" });
	buildOk(root, { extra: ["--env", "development"] });
	assert.equal(read(root, "_site/index.html"), "Pine Cone Crunch");

	const file = path.join(root, "_data/snacks.js");
	fs.writeFileSync(file, "module.exports = [\"Yeti Yogurt\"];");
	const later = new Date(fs.statSync(file).mtimeMs + 2000);
	fs.utimesSync(file, later, later);
	buildOk(root, { extra: ["--env", "development"] });
	assert.equal(read(root, "_site/index.html"), "Yeti Yogurt");
});

test("fetch_saves_responses_with_a_cache_option", FETCH, async () => {
	const { base, stop } = await serve();
	try {
		const script = (body) => `const base = "${base}";
const out = [];
const get = async (path, init) => { const r = await fetch(base + path, init); return \`\${await r.text()}:\${r.headers.get("x-ssqch-cache") ?? "network"}\`; };
${body}
export default out.join(" ");
`;
		const root = site({ "index.edge": "{{{ out }}}" });
		// A build with `body` as the data file: { ok, text } or { ok: false, text: the error }.
		const run = (body, env) => {
			fs.mkdirSync(path.join(root, "_data"), { recursive: true });
			fs.writeFileSync(path.join(root, "_data/out.js"), script(body));
			const r = build(root, { env });
			return r.ok ? { ok: true, text: read(root, "_site/index.html") } : { ok: false, text: r.log.replace(/^error: /, "") };
		};
		const must = (r) => {
			assert.ok(r.ok, r.text);
			return r.text;
		};
		// Saved by the first request, reused by the second; without `cache`, the network every time.
		const first = must(run(`out.push(await get("/count", { cache: "1h" }), await get("/count", { cache: "1h" }), await get("/count"), await get("/count", { cache: 3600 }));`));
		const n = Number(first.split(":")[0]);
		assert.equal(first, `${n}:network ${n}:hit ${n + 1}:network ${n}:hit`);
		// The next build reuses it too. "reload" asks again and saves; a different request is a different entry.
		const second = must(run(`out.push(await get("/count", { cache: "1h" }), await get("/count", { cache: "reload" }), await get("/count", { cache: "force-cache" }), await get("/count?b", { cache: "1h" }), await get("/count", { cache: "1h", headers: { "X-Token": "b" } }));`));
		assert.equal(second, `${n}:hit ${n + 2}:network ${n + 2}:hit ${n + 3}:network ${n + 4}:network`);
		// Nothing an API key could be in is saved: not the URL (a query string), not request headers, not cookies.
		const keyed = must(run(`out.push(await get("/count?api_key=SUPERSECRET", { cache: "1h" }), await get("/count?api_key=SUPERSECRET", { cache: Infinity }), (await fetch(base + "/count?api_key=SUPERSECRET", { cache: 1e30 })).url.endsWith("api_key=SUPERSECRET"));`));
		assert.ok(keyed.endsWith(":hit true"), keyed);
		const cacheDir = path.join(root, ".cache/ssqch/fetch");
		const entries = fs.readdirSync(cacheDir);
		const onDisk = entries.map((name) => `${name} ${fs.readFileSync(path.join(cacheDir, name), "utf8")}`).join("");
		assert.ok(!onDisk.includes("SUPERSECRET") && !onDisk.includes(".tmp"), onDisk);
		// Cookies and request headers aren't saved.
		const saved = entries.filter((name) => name.endsWith(".json")).map((name) => fs.readFileSync(path.join(cacheDir, name), "utf8")).join("");
		assert.ok(saved.includes("\"savedAt\"") && !saved.includes("set-cookie") && !saved.includes("X-Token") && !saved.includes("x-token"), saved);

		// A failed refresh falls back to the older copy; without one, the failure is the answer.
		const flaky = must(run(`out.push(await get("/flaky", { cache: "0s" }), await get("/flaky", { cache: "0s" }), await get("/flaky"));`));
		assert.equal(flaky, "fine:network fine:stale down:network");
		const only = must(run(`try { await get("/never", { cache: "only-if-cached" }); } catch (e) { out.push(e.message); }`));
		assert.ok(only.endsWith("/never: no saved copy (cache: \"only-if-cached\")"), only);
		const bad = must(run(`try { await get("/count", { cache: "soon" }); } catch (e) { out.push(e.message); }`));
		assert.ok(bad.startsWith("fetch: cache \"soon\" isn't a duration like \"1h\""), bad);

		// Offline: saved copies whatever their age, and nothing else.
		const offline = run(`out.push(await get("/count", { cache: "1s" }));
for (const init of [{ cache: "1h" }, undefined]) { try { await get("/count?new", init); } catch (e) { out.push(e.message.replace(/^.*?: offline/, "offline").replace(/ in .*$/, "")); } }`, { SSQCH_OFFLINE: "1" });
		assert.equal(must(offline), `${n + 2}:hit offline (SSQCH_OFFLINE), and there's no saved copy offline (SSQCH_OFFLINE), and this request has no \`cache\` option, so there's no saved copy to use`);
	} finally {
		stop();
	}
});
