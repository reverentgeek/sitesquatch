import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import zlib from "node:zlib";
import { takeWarnings, capture } from "./diagnostics.ts";
import { installFetch, summary } from "./fetch.ts";
import { VERSION } from "./version.ts";

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
		if (req.url!.startsWith("/echo")) {
			// What arrived: the method, the headers as they were sent, and the body.
			const chunks: Buffer[] = [];
			req.on("data", (c) => chunks.push(c));
			req.on("end", () => {
				res.writeHead(200, { connection: "close", "content-type": "application/json" });
				res.end(JSON.stringify({ method: req.method, headers: req.headers, body: Buffer.concat(chunks).toString() }));
			});
			return;
		}
		if (req.url === "/gzip") {
			const zipped = zlib.gzipSync("zipped pine cones");
			res.writeHead(200, { connection: "close", "content-encoding": "gzip", "content-length": zipped.length, "set-cookie": ["c=1", "d=2"] });
			res.end(zipped);
			return;
		}
		let status = 200, text = "ok";
		const headers: Record<string, string | string[]> = { connection: "close" };
		if (req.url!.startsWith("/count")) { text = String(++count); headers["set-cookie"] = "a=1"; }
		else if (req.url === "/flaky") { if (flaky++ > 0) { status = 503; text = "down"; } }
		else if (req.url === "/gone") { status = 404; text = "nope"; }
		else if (req.url === "/empty") { status = 204; text = ""; }
		else if (req.url === "/moved") { status = 302; headers.location = "/count?moved"; text = ""; }
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

/** What the test server's `/echo` saw. */
const echo = async (url: string, init?: object) => (await (await fetch(url, init)).json()) as { method: string; headers: Record<string, string>; body: string };

test("requests go out as 0.7 sent them: credentials, user agent, and the headers Node's fetch refuses", async () => {
	// Credentials in the URL are Basic auth (Node's fetch refuses the URL), unless the request has its own.
	const credentials = base.replace("http://", "http://ran%20ger:pine@cone@");
	assert.equal((await echo(`${credentials}/echo`)).headers.authorization, `Basic ${Buffer.from("ran%20ger:pine%40cone").toString("base64")}`);
	assert.equal((await echo(`${credentials}/echo`, { headers: { Authorization: "Bearer x" } })).headers.authorization, "Bearer x");
	assert.equal((await echo(`${credentials}/echo?cached`, { cache: "1h" })).headers.authorization, `Basic ${Buffer.from("ran%20ger:pine%40cone").toString("base64")}`);
	// An error names the URL without the password.
	const refused = await fails("http://ranger:secret@127.0.0.1:1/x");
	assert.match(refused.message, /^fetch failed: http:\/\/ranger@127\.0\.0\.1:1\/x: \S/);
	assert.ok(!refused.message.includes("secret"), refused.message);
	// The user agent is ssqch's, or the site's.
	assert.equal((await echo(`${base}/echo`)).headers["user-agent"], `ssqch/${VERSION}`);
	assert.equal((await echo(`${base}/echo`, { headers: { "User-Agent": "pine/1" } })).headers["user-agent"], "pine/1");
	// Node's fetch drops `Host` and refuses these; they go out through node:http.
	for (const [name, value] of [["Host", "example.com"], ["Keep-Alive", "timeout=5"], ["Upgrade", "websocket"], ["Expect", "100-continue"]]) {
		const seen = await echo(`${base}/echo`, { method: "POST", body: "pine", headers: { [name]: value } });
		assert.deepEqual([seen.headers[name.toLowerCase()], seen.body, seen.headers["user-agent"]], [value, "pine", `ssqch/${VERSION}`], name);
	}
	const chunked = await echo(`${base}/echo`, { method: "POST", body: "cone", headers: { "Transfer-Encoding": "chunked" } });
	assert.deepEqual([chunked.headers["transfer-encoding"], chunked.body], ["chunked", "cone"]);
	// They're answered as fetch answers: redirects followed, bodies decoded, cookies kept.
	const moved = await fetch(`${base}/moved`, { headers: { Host: "example.com" } });
	assert.deepEqual([moved.status, moved.redirected, moved.url.endsWith("/count?moved"), moved.type], [200, true, true, "basic"]);
	const zipped = await fetch(`${base}/gzip`, { headers: { "Keep-Alive": "timeout=5" } });
	assert.deepEqual([await zipped.text(), zipped.headers.getSetCookie()], ["zipped pine cones", ["c=1", "d=2"]]);
	// A blocked port (the Fetch standard's list) is asked, as 0.7 asked it, rather than refused as a "bad port".
	assert.match((await fails("http://127.0.0.1:6666/")).message, /^fetch failed: http:\/\/127\.0\.0\.1:6666\/: (?!bad port)\S/);
	summary();
});

test("concurrent calls for one URL with cache take turns, and the later ones find the saved copy", async () => {
	const n = count;
	const all = await Promise.all(Array.from({ length: 30 }, () => fetch(`${base}/count?together`, { cache: "1d" } as object).then((r) => r.headers.get("x-ssqch-cache") ?? "network")));
	assert.deepEqual([all.filter((x) => x === "network").length, all.filter((x) => x === "hit").length], [8, 22]);
	assert.equal(count, n + 8);
	assert.equal(summary(), "30 requests, 22 from the cache");
});

test("a fresh reply with cache is the saved one: cookies once, no content-encoding, type basic", async () => {
	const fresh = await fetch(`${base}/gzip`, { cache: "1h" } as object);
	assert.deepEqual([fresh.headers.getSetCookie(), fresh.headers.get("content-encoding"), fresh.headers.get("content-length"), fresh.type, await fresh.text()], [["c=1", "d=2"], null, null, "basic", "zipped pine cones"]);
	const hit = await fetch(`${base}/gzip`, { cache: "1h" } as object);
	assert.deepEqual([hit.headers.getSetCookie(), hit.headers.get("content-encoding"), hit.type, hit.headers.get("x-ssqch-cache")], [[], null, "basic", "hit"]);
});

test("cache: null and a Request with ssqch's cache work as in 0.7", async () => {
	const n = count;
	assert.equal(await get("/count?null", { cache: null }), `${n + 1}:network`);
	const request = new Request(`${base}/count?request`, { cache: "1h" } as RequestInit);
	assert.equal((request as { cache: unknown }).cache, "1h");
	assert.ok(request instanceof Request);
	assert.equal(`${await (await fetch(request)).text()}`, String(n + 2));
	const again = await fetch(new Request(`${base}/count?request`, { cache: 3600 } as unknown as RequestInit));
	assert.deepEqual([await again.text(), again.headers.get("x-ssqch-cache")], [String(n + 2), "hit"]);
	// A Request with credentials in its URL sends them, where Node's refuses the URL.
	const credentialed = new Request(base.replace("http://", "http://ranger:cone@") + "/echo");
	assert.equal(((await (await fetch(credentialed)).json()) as { headers: Record<string, string> }).headers.authorization, `Basic ${Buffer.from("ranger:cone").toString("base64")}`);
	summary();
});

test("requests that never go out aren't counted, and a bad URL is 0.7's TypeError", async () => {
	summary();
	assert.equal(((await fetch("not a url").catch((e) => e)) as Error).message, "Invalid URL: not a url");
	assert.equal(((await fetch("/relative").catch((e) => e)) as Error).message, "Invalid URL: /relative");
	await fails("file:///etc/hosts");
	await fails(`${base}/count`, { method: "GET", body: "x" });
	await fails(`${base}/count`, { signal: AbortSignal.abort() });
	assert.equal(summary(), undefined);
});
