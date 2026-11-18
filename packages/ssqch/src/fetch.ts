// `fetch()` for a site's JavaScript: Node's own, wrapped once with what 0.7 added. Errors in 0.7's
// words (`fetch failed: <url>: <reason>`, where Node says only `fetch failed` and keeps the
// reason in `cause`), and the `cache` option: `fetch(url, { cache: "1h" })` saves a successful
// response under `.cache/ssqch/fetch/` and reuses it until it's that old. When a refresh fails
// and an older copy is there, the build uses it and warns. With `SSQCH_OFFLINE` set
// (`--offline`), saved copies are used whatever their age, and nothing is requested.
//
// 0.7's requests went out as a site wrote them, and Node's fetch follows the Fetch standard,
// which refuses or changes some of them. So credentials in the URL become Basic auth (Node
// refuses the URL), the user agent is `ssqch/<version>` unless the site sets one, and a request
// for one of the standard's blocked ports, or with a `Host`, `Keep-Alive`, `Transfer-Encoding`,
// `Upgrade` or `Expect` header, goes out through node:http, as fetch would answer it otherwise.

import { createHash } from "node:crypto";
import fs from "node:fs";
import type { IncomingMessage } from "node:http";
import type { RequestOptions } from "node:https";
import path from "node:path";
import type { Readable } from "node:stream";
import { warn, warning } from "./diagnostics.ts";
import { VERSION } from "./version.ts";

/** How requests were answered since the last summary: asked the network, fresh from the cache, stale from the cache after a failure. */
const counts = { asked: 0, hits: 0, stale: 0 };

let cacheDir = "";
const original: typeof globalThis.fetch = globalThis.fetch;
const NodeRequest: typeof Request = globalThis.Request;
let installed = false;

const USER_AGENT = `ssqch/${VERSION}`;

/** Whether `--offline` (or `SSQCH_OFFLINE`) is on. */
export function offline(): boolean {
	const value = process.env.SSQCH_OFFLINE;
	return value !== undefined && !["", "0", "false"].includes(value);
}

/** The build summary's `Fetch` line: how this build's requests were answered, or nothing when there were none. */
export function summary(): string | undefined {
	const { asked, hits, stale } = counts;
	counts.asked = counts.hits = counts.stale = 0;
	savedThisBuild.clear();
	const total = asked + hits + stale;
	if (total === 0) return undefined;
	let line = `${total} request${total === 1 ? "" : "s"}`;
	if (hits + stale > 0) line += `, ${hits + stale} from the cache`;
	if (stale > 0) line += ` (${stale} out of date, after a failed request)`;
	if (offline()) line += " (--offline: living off the cache)";
	return line;
}

/** Wraps `fetch` (and `Request`, for its `cache`) for a site rooted at `root`. Safe to call again (serving reads the configuration again): the saved copies are then in the new root. */
export function installFetch(root: string): void {
	cacheDir = path.join(root, ".cache/ssqch/fetch");
	if (installed) return;
	installed = true;
	globalThis.fetch = ssqchFetch as typeof globalThis.fetch;
	globalThis.Request = SsqchRequest;
}

// ---- the cache option -------------------------------------------------------------------------

type Cache =
	/** Always ask the network, and save nothing (the default). */
	| { mode: "off" }
	/** Use a saved copy younger than this (milliseconds); otherwise ask, and save the answer. */
	| { mode: "max-age"; ms: number }
	/** `"force-cache"`: use a saved copy of any age; ask only without one. */
	| { mode: "forever" }
	/** `"reload"`: ask, and save the answer. */
	| { mode: "reload" }
	/** `"only-if-cached"`: use a saved copy of any age, or fail. */
	| { mode: "only" };

const UNITS: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400, w: 604800 };

/** A request's `cache`: one of the standard modes, or how long a saved response stays good (`"90s"`, `"30m"`, `"1h"`, `"7d"`, `"2w"`, or seconds as a number). */
function parseCache(cache: unknown): Cache {
	if (typeof cache === "number" && cache >= 0) return { mode: "max-age", ms: cache * 1000 };
	const duration = /^(\d+(?:\.\d+)?)\s*([smhdw])$/.exec(String(cache).trim());
	if (duration) return { mode: "max-age", ms: Number(duration[1]) * UNITS[duration[2]] * 1000 };
	switch (cache) {
		case "default": case "no-store": case "no-cache": return { mode: "off" };
		case "force-cache": return { mode: "forever" };
		case "reload": return { mode: "reload" };
		case "only-if-cached": return { mode: "only" };
	}
	throw new TypeError(`fetch: cache ${JSON.stringify(cache)} isn't a duration like "1h" (s, m, h, d or w), or "force-cache", "reload", "only-if-cached" or "no-store"`);
}

// ---- Request, with 0.7's `cache` and credentials ---------------------------------------------

/** The `cache` values Node's Request takes. Others (`"1h"`, a number of seconds, `null`) are ssqch's, and 0.7's Request took them. */
const NODE_CACHE = new Set(["default", "no-store", "reload", "no-cache", "force-cache", "only-if-cached"]);

/** What a Request was made with that Node's doesn't keep: ssqch's `cache`, and its URL with the credentials in it. */
const extras = new WeakMap<Request, { cache?: unknown; href?: string }>();

/**
 * `Request` as 0.7 had it: `new Request(url, { cache: "1h" })` and a URL with credentials in it
 * work, where Node's refuses both. It's Node's Request otherwise (a Proxy, so `instanceof` and
 * subclasses work as they did).
 */
const SsqchRequest = new Proxy(NodeRequest, {
	construct(target, args: unknown[], newTarget) {
		let [input, init] = args;
		const from = input instanceof NodeRequest ? extras.get(input) : undefined;
		let cache = from?.cache;
		let href = from?.href;
		if (init !== null && typeof init === "object") {
			const value = (init as { cache?: unknown }).cache;
			if (value !== undefined && !(typeof value === "string" && NODE_CACHE.has(value))) {
				const { cache: _ssqch, ...rest } = init as { cache?: unknown };
				init = rest;
				if (value !== null) cache = value;
			} else if (value !== undefined) cache = undefined;
		}
		if (!(input instanceof NodeRequest)) {
			const text = input instanceof URL ? input.href : String(input);
			const url = URL.canParse(text) ? new URL(text) : undefined;
			href = undefined;
			if (url && (url.username || url.password)) {
				href = url.href;
				url.username = url.password = "";
				input = url.href;
			}
		}
		const request = Reflect.construct(target, [input, init], newTarget) as Request;
		if (cache !== undefined || href !== undefined) extras.set(request, { cache, href });
		if (cache !== undefined) Object.defineProperty(request, "cache", { value: cache, enumerable: true, configurable: true });
		return request;
	},
});

// ---- the wrapper ------------------------------------------------------------------------------

/** Requests in flight at once; more wait for a turn, as in 0.7, so a thousand `fetch`es in a `Promise.all` don't open a thousand connections. */
const MAX_RUNNING = 8;
let running = 0;
const waiting: Array<() => void> = [];

/** Runs `work` in a turn of its own. A request without `cache` has its turn until its headers arrive; one with `cache` until its answer is saved, so the calls after it for the same URL find the saved copy, as in 0.7. */
async function inTurn<T>(work: () => Promise<T>): Promise<T> {
	if (running >= MAX_RUNNING) await new Promise<void>((resolve) => waiting.push(resolve));
	else running++;
	try {
		return await work();
	} finally {
		// The turn goes to the next in line, or is freed.
		const next = waiting.shift();
		if (next) next(); else running--;
	}
}

/** Headers Node's fetch leaves out (`Host`) or refuses, and 0.7 sent. */
const NODE_HTTP_HEADERS = ["host", "keep-alive", "transfer-encoding", "upgrade", "expect"];
/** The ports the Fetch standard blocks, which Node's fetch won't connect to and 0.7 did. */
const BLOCKED_PORTS = new Set([1, 7, 9, 11, 13, 15, 17, 19, 20, 21, 22, 23, 25, 37, 42, 43, 53, 69, 77, 79, 87, 95, 101, 102, 103, 104, 109, 110, 111, 113, 115, 117, 119, 123, 135, 137, 139, 143, 161, 179, 389, 427, 465, 512, 513, 514, 515, 526, 530, 531, 532, 540, 548, 554, 556, 563, 587, 601, 636, 989, 990, 993, 995, 1719, 1720, 1723, 2049, 3659, 4045, 4190, 5060, 5061, 6000, 6566, 6665, 6666, 6667, 6668, 6669, 6679, 6697, 10080]);

const send = (request: Request, viaNodeHttp: boolean) => (viaNodeHttp ? nodeHttpFetch(request) : original(request));

const isAbort = (e: unknown) => e instanceof DOMException && (e.name === "AbortError" || e.name === "TimeoutError");

/** Why Node's `fetch failed`: the cause's message, or its code when the message is empty (an AggregateError from a refused connection). */
function reasonOf(e: unknown): string {
	let cause: any = (e as any)?.cause;
	if (cause?.errors?.length && !cause.message) cause = cause.errors[0];
	const message = String(cause?.message || cause?.code || (e as any)?.message || e);
	return message.replace(/^fetch failed: /, "");
}

/** Node's `fetch failed` as 0.7 said it: with the URL and the reason. Anything else (an abort, a bad argument) is left as it is. */
function worded(e: unknown, url: string): unknown {
	if (e instanceof TypeError && e.message === "fetch failed") {
		return Object.assign(new TypeError(`fetch failed: ${url}: ${reasonOf(e)}`), { cause: (e as any).cause });
	}
	return e;
}

async function ssqchFetch(input: string | URL | Request, init?: RequestInit & { cache?: unknown }): Promise<Response> {
	const options = init !== null && typeof init === "object" ? init : undefined;
	const from = input instanceof NodeRequest ? extras.get(input) : undefined;
	// `null` is the default, as in 0.7.
	const cache = parseCache(options?.cache ?? (input instanceof NodeRequest ? from?.cache ?? input.cache : "default"));
	// The URL as 0.7 had it, credentials and all: the cache's key is made from it.
	let href: string;
	if (input instanceof NodeRequest) href = from?.href ?? input.url;
	else {
		const text = input instanceof URL ? input.href : String(input);
		if (!URL.canParse(text)) throw new TypeError(`Invalid URL: ${text}`);
		href = new URL(text).href;
	}
	const target = new URL(href);
	// In messages, the URL without its password.
	const masked = new URL(href);
	masked.password = "";
	const shown = masked.href;
	if (target.protocol !== "http:" && target.protocol !== "https:") throw new TypeError(`fetch failed: ${shown}: only http: and https: URLs can be fetched`);
	let auth: string | undefined;
	if (target.username || target.password) {
		auth = `Basic ${Buffer.from(`${target.username}:${target.password}`).toString("base64")}`;
		target.username = target.password = "";
	}
	// Node checks the method, headers and body here, and its errors are the answer. `cache` is
	// ssqch's, and Node's own modes would add headers 0.7 never sent.
	const { cache: _ssqch, ...rest } = options ?? {};
	const request = new NodeRequest(input instanceof NodeRequest ? input : target.href, { ...rest, cache: "default" } as RequestInit);
	const asked = [...request.headers];
	if (auth !== undefined && !request.headers.has("authorization")) request.headers.set("authorization", auth);
	if (!request.headers.has("user-agent")) request.headers.set("user-agent", USER_AGENT);
	const viaNodeHttp = (target.port !== "" && BLOCKED_PORTS.has(Number(target.port))) || NODE_HTTP_HEADERS.some((name) => request.headers.has(name));
	if (request.signal.aborted) throw request.signal.reason;
	const isOffline = offline();
	if (cache.mode === "off" && !isOffline) {
		return inTurn(async () => {
			counts.asked++;
			try { return await send(request, viaNodeHttp); } catch (e) { throw worded(e, shown); }
		});
	}
	const body = new Uint8Array(await request.clone().arrayBuffer());
	const ask: Ask = { method: request.method, url: href, headers: asked, body };
	return inTurn(() => answer(request, ask, shown, cache, isOffline, viaNodeHttp));
}

/** Content codings Node's fetch (and ours, through node:http) decodes; a body in one of these is saved decoded. */
const DECODED = new Set(["gzip", "x-gzip", "deflate", "br"]);

/** Answer a request from the cache or the network, as its `cache` option says. */
async function answer(request: Request, ask: Ask, shown: string, cache: Cache, isOffline: boolean, viaNodeHttp: boolean): Promise<Response> {
	const copy = cache.mode === "off" ? undefined : saved(ask);
	const fresh = (old: number) => {
		switch (cache.mode) {
			case "max-age": return old <= cache.ms;
			case "forever": case "only": return true;
			default: return false;
		}
	};
	if (copy && (isOffline || fresh(copy.old))) {
		counts.hits++;
		return fromCache(copy, request.url, "hit");
	}
	if (!copy && isOffline && cache.mode === "off") throw new TypeError(`fetch failed: ${shown}: offline (SSQCH_OFFLINE), and this request has no \`cache\` option, so there's no saved copy to use`);
	if (!copy && isOffline) throw new TypeError(`fetch failed: ${shown}: offline (SSQCH_OFFLINE), and there's no saved copy in ${cacheDir}`);
	if (!copy && cache.mode === "only") throw new TypeError(`fetch failed: ${shown}: no saved copy (cache: "only-if-cached")`);

	counts.asked++;
	let response: Response | undefined;
	let failure: string | undefined;
	let thrown: unknown;
	try {
		response = await send(request, viaNodeHttp);
		// 5xx, or 429 (asked too often): the server's trouble, not the request's.
		if (response.status >= 500 || response.status === 429) failure = `answered ${response.status}`;
	} catch (e) {
		if (isAbort(e) && (e as DOMException).name !== "TimeoutError") throw e;
		thrown = worded(e, shown);
		failure = (e as DOMException).name === "TimeoutError" ? "timed out (TimeoutError)" : reasonOf(e);
	}
	// An older copy is better than no build.
	if (failure !== undefined && copy) {
		warn(warning("fetch", `fetch: ${shown} ${failure}; using the copy saved ${age(copy.old)}`));
		counts.stale++;
		return fromCache(copy, request.url, "stale");
	}
	if (failure !== undefined && response === undefined) throw thrown;
	if (response && response.status >= 200 && response.status < 300) {
		// Read now, to save it and to hand the build a response that has its body in hand. The
		// body is decoded, so what described its encoding goes, as 0.7's HTTP library dropped it.
		const bytes = new Uint8Array(await response.arrayBuffer());
		const codings = (response.headers.get("content-encoding") ?? "").toLowerCase().split(",").map((c) => c.trim()).filter((c) => c !== "");
		const decoded = codings.length > 0 && codings.every((c) => DECODED.has(c));
		const headers = [...response.headers].filter(([k]) => !decoded || (k !== "content-encoding" && k !== "content-length"));
		const reply: Reply = { status: response.status, statusText: response.statusText, redirected: response.redirected, headers, body: bytes };
		try { await save(ask, reply); } catch (e) {
			warn(warning("fetch", `fetch: couldn't save ${shown} in ${cacheDir}: ${(e as Error).message}`));
		}
		return make(reply, response.url || request.url);
	}
	return response!;
}

// ---- requests through node:http --------------------------------------------------------------

const REDIRECTS = new Set([301, 302, 303, 307, 308]);

/** Node's modules for these requests, loaded the first time one goes out: most builds never need them. */
const load = () => Promise.all([import("node:http"), import("node:https"), import("node:net"), import("node:stream"), import("node:zlib")]).then(([http, https, net, stream, zlib]) => ({ http: http.default, https: https.default, net: net.default, stream: stream.default, zlib: zlib.default }));
let loaded: ReturnType<typeof load> | undefined;
const nodeModules = () => (loaded ??= load());
type Modules = Awaited<ReturnType<typeof load>>;

/** A decoder for a content coding, as Node's fetch decodes (a gzip body cut short gives what arrived). */
function decoder(zlib: Modules["zlib"], coding: string): NodeJS.ReadWriteStream | undefined {
	const sync = { flush: zlib.constants.Z_SYNC_FLUSH, finishFlush: zlib.constants.Z_SYNC_FLUSH };
	switch (coding) {
		case "gzip": case "x-gzip": return zlib.createGunzip(sync);
		case "deflate": return zlib.createInflate();
		case "br": return zlib.createBrotliDecompress();
	}
	return undefined;
}

const failed = (reason: string) => new TypeError("fetch failed", { cause: new Error(reason) });

/**
 * A request Node's fetch would refuse or change, sent with node:http as 0.7 sent it, and
 * answered as fetch answers: the headers fetch adds, redirects followed (or not, as `redirect`
 * says), the body decoded, and an abort heard.
 */
async function nodeHttpFetch(request: Request): Promise<Response> {
	const modules = await nodeModules();
	let body: Buffer | undefined = request.body === null ? undefined : Buffer.from(await request.arrayBuffer());
	let url = new URL(request.url);
	let method = request.method;
	const headers = new Headers(request.headers);
	for (const [name, value] of [["accept", "*/*"], ["accept-language", "*"], ["sec-fetch-mode", "cors"], ["accept-encoding", "gzip, deflate"]]) {
		if (!headers.has(name)) headers.set(name, value);
	}
	let redirected = false;
	for (let hops = 0; ; hops++) {
		const res = await exchange(modules, url, method, headers, body, request.signal);
		const status = res.statusCode ?? 0;
		const location = res.headers.location;
		if (!REDIRECTS.has(status) || location === undefined || request.redirect === "manual") return toResponse(modules, res, url, redirected, method, request.signal);
		res.resume();
		if (request.redirect === "error") throw failed("unexpected redirect");
		if (hops >= 20) throw failed("redirect count exceeded");
		if (!URL.canParse(location, url.href)) throw failed("invalid redirect location");
		const next = new URL(location, url);
		if (next.protocol !== "http:" && next.protocol !== "https:") throw failed("URL scheme must be a HTTP(S) scheme");
		if (status === 303 ? method !== "GET" && method !== "HEAD" : (status === 301 || status === 302) && method === "POST") {
			method = "GET";
			body = undefined;
			for (const name of ["content-encoding", "content-language", "content-location", "content-type", "content-length", "transfer-encoding"]) headers.delete(name);
		}
		// Credentials and the host are for the server they were written for.
		if (next.origin !== url.origin) for (const name of ["authorization", "proxy-authorization", "cookie", "host"]) headers.delete(name);
		url = next;
		redirected = true;
	}
}

function exchange({ http, https, net }: Modules, url: URL, method: string, headers: Headers, body: Buffer | undefined, signal: AbortSignal): Promise<IncomingMessage> {
	return new Promise((resolve, reject) => {
		if (signal.aborted) return reject(signal.reason);
		const outgoing: Record<string, string> = {};
		for (const [name, value] of headers) outgoing[name] = value;
		if (body !== undefined && !headers.has("content-length") && !headers.has("transfer-encoding")) outgoing["content-length"] = String(body.length);
		const options: RequestOptions = { method, headers: outgoing };
		// The server's name for TLS is the URL's, whatever the `Host` header says (Node would take that).
		if (url.protocol === "https:" && net.isIP(url.hostname.replace(/^\[|\]$/g, "")) === 0) options.servername = url.hostname;
		const req = (url.protocol === "https:" ? https : http).request(url, options);
		const onAbort = () => req.destroy();
		signal.addEventListener("abort", onAbort, { once: true });
		req.once("response", (res) => {
			signal.removeEventListener("abort", onAbort);
			resolve(res);
		});
		req.once("upgrade", (res, socket) => {
			socket.destroy();
			reject(failed(`the server switched protocols (${res.statusCode})`));
		});
		req.once("error", (e) => {
			signal.removeEventListener("abort", onAbort);
			reject(signal.aborted ? signal.reason : new TypeError("fetch failed", { cause: e }));
		});
		// As long as Node's fetch waits for the headers.
		req.setTimeout(300_000, () => req.destroy(new Error("headers timeout")));
		req.end(body);
	});
}

function toResponse({ stream: { Readable, pipeline }, zlib }: Modules, res: IncomingMessage, url: URL, redirected: boolean, method: string, signal: AbortSignal): Response {
	const status = res.statusCode ?? 0;
	const headers = new Headers();
	for (let i = 0; i < res.rawHeaders.length; i += 2) headers.append(res.rawHeaders[i], res.rawHeaders[i + 1]);
	let body: ReadableStream | null = null;
	if (method === "HEAD" || [101, 103, 204, 205, 304].includes(status)) res.resume();
	else {
		const codings = String(res.headers["content-encoding"] ?? "").toLowerCase().split(",").map((c) => c.trim()).filter((c) => c !== "");
		const decoders = codings.length > 0 && codings.every((c) => DECODED.has(c)) ? codings.reverse().map((c) => decoder(zlib, c)!) : [];
		const stream = decoders.length ? (pipeline([res, ...decoders], () => {}) as unknown as Readable) : res;
		body = Readable.toWeb(stream) as ReadableStream;
		signal.addEventListener("abort", () => res.destroy(signal.reason), { once: true });
	}
	// A status Response takes (200 to 599), with the server's own set on it after.
	const response = new Response(body, { status: status >= 200 && status <= 599 ? status : 200, statusText: res.statusMessage ?? "", headers });
	const answered = new URL(url);
	answered.hash = "";
	Object.defineProperty(response, "url", { value: answered.href, configurable: true });
	Object.defineProperty(response, "redirected", { value: redirected, configurable: true });
	Object.defineProperty(response, "type", { value: "basic", configurable: true });
	if (status < 200 || status > 599) {
		Object.defineProperty(response, "status", { value: status, configurable: true });
		Object.defineProperty(response, "ok", { value: false, configurable: true });
	}
	return response;
}

// ---- saved responses --------------------------------------------------------------------------

interface Ask { method: string; url: string; headers: Array<[string, string]>; body: Uint8Array }
interface Reply { status: number; statusText: string; redirected: boolean; headers: Array<[string, string]>; body: Uint8Array }

/**
 * The files a request's saved response is in: `<key>.json` (the status, headers and when it was
 * saved) and `<key>.body`. The key covers the method, URL, request headers and body, so a
 * different query or token is a different entry. Neither the URL nor the request headers are
 * written anywhere: an API key is often in one of them, and CI caches keep this folder. The key is
 * 0.7's, so a folder it filled still answers.
 */
function cachePaths(ask: Ask): [string, string] {
	const hash = createHash("sha256");
	hash.update(ask.method.toUpperCase());
	hash.update("\n");
	hash.update(ask.url);
	const headers = ask.headers.map(([k, v]) => `${k.toLowerCase()}:${v}`).sort();
	for (const h of headers) {
		hash.update("\n");
		hash.update(h);
	}
	hash.update("\n\n");
	hash.update(ask.body);
	const key = hash.digest("hex").slice(0, 32);
	return [path.join(cacheDir, `${key}.json`), path.join(cacheDir, `${key}.body`)];
}

/** A saved response and how old it is (milliseconds). The age is from whole seconds, like the file's `savedAt`. */
/**
 * What this build saved, by its cache file, so the requests after it find it without reading the
 * disk: on Windows a file another request is moving into place can't be read for that moment, and
 * the request went to the network. Emptied with each build's summary.
 */
const savedThisBuild = new Map<string, { reply: Reply; savedAt: number }>();

function saved(ask: Ask): (Reply & { old: number }) | undefined {
	const [metaPath, bodyPath] = cachePaths(ask);
	const kept = savedThisBuild.get(metaPath);
	if (kept) return { ...kept.reply, old: Math.max(0, Date.now() - kept.savedAt * 1000) };
	try {
		const meta = JSON.parse(fs.readFileSync(metaPath, "utf8"));
		const body = fs.readFileSync(bodyPath);
		if (!Number.isInteger(meta.savedAt) || !Number.isInteger(meta.status) || !Array.isArray(meta.headers)) return undefined;
		const headers = (meta.headers as unknown[]).flatMap((pair) => Array.isArray(pair) && typeof pair[0] === "string" && typeof pair[1] === "string" ? [[pair[0], pair[1]] as [string, string]] : []);
		return { status: meta.status, statusText: typeof meta.statusText === "string" ? meta.statusText : "", redirected: meta.redirected === true, headers, body, old: Math.max(0, Date.now() - meta.savedAt * 1000) };
	} catch {
		return undefined;
	}
}

let writes = 0;

async function save(ask: Ask, reply: Reply): Promise<void> {
	const [metaPath, bodyPath] = cachePaths(ask);
	await fs.promises.mkdir(cacheDir, { recursive: true });
	const meta = {
		method: ask.method,
		status: reply.status,
		statusText: reply.statusText,
		redirected: reply.redirected,
		// Cookies aren't for keeping.
		headers: reply.headers.filter(([k]) => k.toLowerCase() !== "set-cookie"),
		savedAt: Math.floor(Date.now() / 1000),
	};
	savedThisBuild.set(metaPath, { reply: { ...reply, headers: meta.headers }, savedAt: meta.savedAt });
	// Each file is written beside its place and moved in, so a request for the same thing at the
	// same moment never reads (or leaves) half a file.
	const put = async (file: string, bytes: Uint8Array | string) => {
		const temp = `${file.replace(/\.[^./\\]+$/, "")}.${process.pid}-${writes++}.tmp`;
		try {
			await fs.promises.writeFile(temp, bytes);
			await fs.promises.rename(temp, file);
		} catch (e) {
			await fs.promises.rm(temp, { force: true });
			throw e;
		}
	};
	await put(bodyPath, reply.body);
	await put(metaPath, JSON.stringify(meta, null, 2));
}

/** A response with `reply`'s parts. `Response`'s own `url`, `redirected` and `type` are read-only, so they're set on the instance (`type` is `"basic"`, as a network response's is). */
function make(reply: Reply, url: string): Response {
	// A status with no body (204, 304) can't be given one.
	const empty = [101, 204, 205, 304].includes(reply.status);
	const response = new Response(empty ? null : reply.body, { status: reply.status, statusText: reply.statusText, headers: reply.headers });
	Object.defineProperty(response, "url", { value: url, configurable: true });
	Object.defineProperty(response, "redirected", { value: reply.redirected, configurable: true });
	Object.defineProperty(response, "type", { value: "basic", configurable: true });
	return response;
}

function fromCache(copy: Reply, url: string, how: "hit" | "stale"): Response {
	const headers = copy.headers.filter(([k]) => k.toLowerCase() !== "x-ssqch-cache");
	headers.push(["x-ssqch-cache", how]);
	// The response's own URL isn't saved (see `save`); the request's stands in for it.
	return make({ ...copy, headers }, url);
}

function age(ms: number): string {
	const s = Math.floor(ms / 1000);
	const [n, unit] = s < 120 ? [s, "second"] : s < 7200 ? [Math.floor(s / 60), "minute"] : s < 172_800 ? [Math.floor(s / 3600), "hour"] : [Math.floor(s / 86_400), "day"];
	return `${n} ${unit}${n === 1 ? "" : "s"} ago`;
}
