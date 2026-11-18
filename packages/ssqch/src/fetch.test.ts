import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { takeWarnings, capture } from "./diagnostics.ts";
import { installFetch, summary } from "./fetch.ts";

let server: http.Server;
let base = "";
let count = 0;
let flaky = 0;
let active = 0;
let mostActive = 0;
const root = fs.mkdtempSync(path.join(os.tmpdir(), "ssqch-fetch-"));
const cacheDir = path.join(root, ".cache/ssqch/fetch");

before(async () => {
	server = http.createServer((req, res) => {
		if (req.url!.startsWith("/slow")) {
			active++;
			mostActive = Math.max(mostActive, active);
			setTimeout(() => { active--; res.end("slow"); }, req.url === "/slow" ? 500 : 40).unref();
			return;
		}
		let status = 200, text = "ok";
		const headers: Record<string, string | string[]> = { connection: "close" };
		if (req.url!.startsWith("/count")) { text = String(++count); headers["set-cookie"] = "a=1"; }
		else if (req.url === "/flaky") { if (flaky++ > 0) { status = 503; text = "down"; } }
		else if (req.url === "/gone") { status = 404; text = "nope"; }
		else if (req.url === "/empty") { status = 204; text = ""; }
		headers["content-length"] = String(Buffer.byteLength(text));
		res.writeHead(status, headers);
		res.end(status === 204 ? undefined : text);
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
	installFetch(root);
	capture();
});

after(() => {
	server.close();
	fs.rmSync(root, { recursive: true, force: true });
	delete process.env.SSQCH_OFFLINE;
});

const get = async (url: string, init?: object) => {
	const r = await fetch(base + url, init);
	return `${await r.text()}:${r.headers.get("x-ssqch-cache") ?? "network"}`;
};
const fails = async (url: string, init?: object) => {
	try { await fetch(url.startsWith("http") || url.startsWith("file") ? url : base + url, init); } catch (e) { return e as Error; }
	assert.fail("it should have rejected");
};

test("a request without a cache option is Node's own, and saves nothing", async () => {
	const n = count;
	assert.equal(await get("/count"), `${n + 1}:network`);
	assert.equal(await get("/count"), `${n + 2}:network`);
	assert.equal(fs.existsSync(cacheDir), false);
	const r = await fetch(`${base}/gone`);
	assert.deepEqual([r.status, r.ok, r.url], [404, false, `${base}/gone`]);
});

test("a failed request rejects with a TypeError in 0.7's words", async () => {
	const e = await fails("http://127.0.0.1:1/");
	assert.ok(e instanceof TypeError);
	assert.match(e.message, /^fetch failed: http:\/\/127\.0\.0\.1:1\/: \S/);
	assert.ok((e as { cause?: unknown }).cause);
	const f = await fails("file:///etc/hosts");
	assert.ok(f instanceof TypeError);
	assert.equal(f.message, "fetch failed: file:///etc/hosts: only http: and https: URLs can be fetched");
	// Not a failed request: a bad argument keeps Node's own error.
	assert.match((await fails("not a url")).message, /URL/);
});

test("a timeout stays a TimeoutError", async () => {
	const e = await fails("/slow", { signal: AbortSignal.timeout(30) });
	assert.equal(e.name, "TimeoutError");
});

test("cache saves a response and reuses it, keyed by the whole request", async () => {
	const n = count;
	assert.equal(await get("/count?k=1", { cache: "1h" }), `${n + 1}:network`);
	assert.equal(await get("/count?k=1", { cache: "1h" }), `${n + 1}:hit`);
	assert.equal(await get("/count?k=1", { cache: 3600 }), `${n + 1}:hit`);
	assert.equal(await get("/count?k=1", { cache: Infinity }), `${n + 1}:hit`);
	assert.equal(await get("/count?k=1", { cache: "force-cache" }), `${n + 1}:hit`);
	assert.equal(await get("/count?k=1", { cache: "reload" }), `${n + 2}:network`);
	assert.equal(await get("/count?k=2", { cache: "1h" }), `${n + 3}:network`);
	assert.equal(await get("/count?k=1", { cache: "1h", headers: { "X-Token": "SECRETTOKEN" } }), `${n + 4}:network`);
	const r = await fetch(`${base}/count?k=1&api_key=SUPERSECRET`, { cache: "1h" } as object);
	assert.ok(r.url.endsWith("api_key=SUPERSECRET"));
	const hit = await fetch(`${base}/count?k=1&api_key=SUPERSECRET`, { cache: "1h" } as object);
	assert.equal(hit.headers.get("x-ssqch-cache"), "hit");
	assert.ok(hit.url.endsWith("api_key=SUPERSECRET"));
	// Nothing an API key could be in is written: not the URL, request headers or cookies.
	const files = fs.readdirSync(cacheDir);
	const onDisk = files.map((name) => `${name} ${fs.readFileSync(path.join(cacheDir, name), "utf8")}`).join("");
	assert.ok(!onDisk.includes("SUPERSECRET") && !onDisk.includes("api_key") && !onDisk.toLowerCase().includes("x-token") && !onDisk.includes("set-cookie"), onDisk);
	assert.ok(onDisk.includes("\"savedAt\""));
	assert.equal(files.filter((name) => name.endsWith(".tmp")).length, 0);
	assert.match(summary()!, /^\d+ requests, \d+ from the cache$/);
	assert.equal(summary(), undefined);
});

test("a response with no body comes back from the cache", async () => {
	assert.equal(await get("/empty", { cache: "1h" }), ":network");
	assert.equal(await get("/empty", { cache: "1h" }), ":hit");
});

test("a failed refresh uses the older copy, and warns", async () => {
	takeWarnings();
	assert.equal(await get("/flaky", { cache: "0s" }), "ok:network");
	await new Promise((resolve) => setTimeout(resolve, 1100));
	assert.equal(await get("/flaky", { cache: "0s" }), "ok:stale");
	const [warning] = takeWarnings();
	assert.match(warning.message, /^fetch: .*\/flaky answered 503; using the copy saved \d+ seconds? ago$/);
	assert.equal(warning.code, "fetch");
	assert.match(summary()!, /\(1 out of date, after a failed request\)/);
	// Without a copy, the failure is the answer.
	assert.equal(await get("/flaky"), "down:network");
});

test("only-if-cached without a copy, and a bad cache value", async () => {
	assert.equal((await fails("/never", { cache: "only-if-cached" })).message, `fetch failed: ${base}/never: no saved copy (cache: "only-if-cached")`);
	const bad = await fails("/count", { cache: "soon" });
	assert.ok(bad instanceof TypeError);
	assert.equal(bad.message, "fetch: cache \"soon\" isn't a duration like \"1h\" (s, m, h, d or w), or \"force-cache\", \"reload\", \"only-if-cached\" or \"no-store\"");
	assert.ok((await fails("/count", { cache: -1 })).message.startsWith("fetch: cache -1 isn't"));
});

test("offline: saved copies of any age answer, nothing else does", async () => {
	process.env.SSQCH_OFFLINE = "1";
	try {
		const n = count;
		assert.match(await get("/count?k=1", { cache: "1s" }), /:hit$/);
		assert.equal((await fails("/count?new", { cache: "1h" })).message, `fetch failed: ${base}/count?new: offline (SSQCH_OFFLINE), and there's no saved copy in ${cacheDir}`);
		assert.equal((await fails("/count?k=1")).message, `fetch failed: ${base}/count?k=1: offline (SSQCH_OFFLINE), and this request has no \`cache\` option, so there's no saved copy to use`);
		assert.equal(count, n);
		assert.match(summary()!, /\(--offline: living off the cache\)$/);
	} finally {
		delete process.env.SSQCH_OFFLINE;
	}
});

test("at most eight requests are in flight at once", async () => {
	const bodies = await Promise.all(Array.from({ length: 24 }, (_, i) => fetch(`${base}/slow?${i}`).then((r) => r.text())));
	assert.equal(bodies.length, 24);
	assert.ok(mostActive > 1 && mostActive <= 8, `${mostActive} at once`);
});
