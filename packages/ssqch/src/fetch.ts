// `fetch()` for a site's JavaScript: Node's own, wrapped once with the two things 0.7 added.
// Errors in 0.7's words (`fetch failed: <url>: <reason>`, where Node says only `fetch failed`
// and keeps the reason in `cause`), and the `cache` option: `fetch(url, { cache: "1h" })` saves a
// successful response under `.cache/ssqch/fetch/` and reuses it until it's that old. When a
// refresh fails and an older copy is there, the build uses it and warns. With `SSQCH_OFFLINE`
// set (`--offline`), saved copies are used whatever their age, and nothing is requested.
// A request without a `cache` option goes to Node's fetch untouched.

import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { warn, warning } from "./diagnostics.ts";

/** How requests were answered since the last summary: asked the network, fresh from the cache, stale from the cache after a failure. */
const counts = { asked: 0, hits: 0, stale: 0 };

let cacheDir = "";
const original: typeof globalThis.fetch = globalThis.fetch;
let installed = false;

/** Whether `--offline` (or `SSQCH_OFFLINE`) is on. */
export function offline(): boolean {
	const value = process.env.SSQCH_OFFLINE;
	return value !== undefined && !["", "0", "false"].includes(value);
}

/** The build summary's `Fetch` line: how this build's requests were answered, or nothing when there were none. */
export function summary(): string | undefined {
	const { asked, hits, stale } = counts;
	counts.asked = counts.hits = counts.stale = 0;
	const total = asked + hits + stale;
	if (total === 0) return undefined;
	let line = `${total} request${total === 1 ? "" : "s"}`;
	if (hits + stale > 0) line += `, ${hits + stale} from the cache`;
	if (stale > 0) line += ` (${stale} out of date, after a failed request)`;
	if (offline()) line += " (--offline: living off the cache)";
	return line;
}

/** Wraps `fetch` for a site rooted at `root`. Safe to call again (serving reads the configuration again): the saved copies are then in the new root. */
export function installFetch(root: string): void {
	cacheDir = path.join(root, ".cache/ssqch/fetch");
	if (installed) return;
	installed = true;
	globalThis.fetch = ssqchFetch as typeof globalThis.fetch;
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

// ---- the wrapper ------------------------------------------------------------------------------

/** Requests in flight at once (until their headers arrive); more wait for a turn, as in 0.7, so a thousand `fetch`es in a `Promise.all` don't open a thousand connections. */
const MAX_RUNNING = 8;
let running = 0;
const waiting: Array<() => void> = [];

async function send(...args: Parameters<typeof globalThis.fetch>): Promise<Response> {
	if (running >= MAX_RUNNING) await new Promise<void>((resolve) => waiting.push(resolve));
	else running++;
	try {
		return await original(...args);
	} finally {
		// The slot goes to the next in line, or is freed.
		const next = waiting.shift();
		if (next) next(); else running--;
	}
}

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

/** The URL a `fetch` call is for, as Node will read it; nothing when it isn't one (Node's own error is then the answer). */
function urlOf(input: unknown): string | undefined {
	try { return input instanceof Request ? input.url : new URL(String(input)).href; } catch { return undefined; }
}

async function ssqchFetch(input: string | URL | Request, init?: RequestInit & { cache?: unknown }): Promise<Response> {
	const given = init && typeof init === "object" ? init.cache : undefined;
	const cache = parseCache(given ?? (input instanceof Request ? input.cache : "default"));
	const url = urlOf(input);
	if (url !== undefined) {
		const protocol = new URL(url).protocol;
		if (protocol !== "http:" && protocol !== "https:") throw new TypeError(`fetch failed: ${url}: only http: and https: URLs can be fetched`);
	}
	const isOffline = offline();
	if (cache.mode === "off" && !isOffline) {
		// Without a `cache` option the call is Node's own, untouched.
		counts.asked++;
		try { return await send(input, init); } catch (e) { throw worded(e, url ?? String(input)); }
	}
	// `cache` is ssqch's here: Node's Request refuses "1h" and "only-if-cached", so it stays off the Request.
	const { cache: _ssqch, ...rest } = init ?? {};
	const request = new Request(input, init ? rest : undefined);
	if (request.signal.aborted) throw request.signal.reason;
	return answer(request, request.url, cache, isOffline);
}

/** Answer a request from the cache or the network, as its `cache` option says. */
async function answer(request: Request, url: string, cache: Cache, isOffline: boolean): Promise<Response> {
	const body = new Uint8Array(await request.clone().arrayBuffer());
	const keyed: Ask = { method: request.method, url, headers: [...request.headers], body };
	const copy = cache.mode === "off" ? undefined : saved(keyed);
	const fresh = (old: number) => {
		switch (cache.mode) {
			case "max-age": return old <= cache.ms;
			case "forever": case "only": return true;
			default: return false;
		}
	};
	if (copy && (isOffline || fresh(copy.old))) {
		counts.hits++;
		return fromCache(copy, url, "hit");
	}
	if (!copy && isOffline && cache.mode === "off") throw new TypeError(`fetch failed: ${url}: offline (SSQCH_OFFLINE), and this request has no \`cache\` option, so there's no saved copy to use`);
	if (!copy && isOffline) throw new TypeError(`fetch failed: ${url}: offline (SSQCH_OFFLINE), and there's no saved copy in ${cacheDir}`);
	if (!copy && cache.mode === "only") throw new TypeError(`fetch failed: ${url}: no saved copy (cache: "only-if-cached")`);

	counts.asked++;
	let response: Response | undefined;
	let failure: string | undefined;
	let thrown: unknown;
	try {
		response = await send(request);
		// 5xx, or 429 (asked too often): the server's trouble, not the request's.
		if (response.status >= 500 || response.status === 429) failure = `answered ${response.status}`;
	} catch (e) {
		if (isAbort(e) && (e as DOMException).name !== "TimeoutError") throw e;
		thrown = worded(e, url);
		failure = (e as DOMException).name === "TimeoutError" ? "timed out (TimeoutError)" : reasonOf(e);
	}
	// An older copy is better than no build.
	if (failure !== undefined && copy) {
		warn(warning("fetch", `fetch: ${url} ${failure}; using the copy saved ${age(copy.old)}`));
		counts.stale++;
		return fromCache(copy, url, "stale");
	}
	if (failure !== undefined && response === undefined) throw thrown;
	if (response && response.status >= 200 && response.status < 300) {
		// Read now, to save it and to hand the build a response that has its body in hand.
		const bytes = new Uint8Array(await response.arrayBuffer());
		const reply: Reply = { status: response.status, statusText: response.statusText, redirected: response.redirected, headers: [...response.headers].map(([k, v]) => [k, v]), body: bytes };
		// `set-cookie` is kept out of a Headers' iteration, and out of the cache; give the build its cookies back.
		for (const cookie of response.headers.getSetCookie()) reply.headers.push(["set-cookie", cookie]);
		try { await save({ ...keyed }, reply); } catch (e) {
			warn(warning("fetch", `fetch: couldn't save ${url} in ${cacheDir}: ${(e as Error).message}`));
		}
		return make(reply, response.url || url);
	}
	return response!;
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
function saved(ask: Ask): (Reply & { old: number }) | undefined {
	const [metaPath, bodyPath] = cachePaths(ask);
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
		// Cookies aren't for keeping. The body is already decoded, so what described its encoding doesn't apply.
		headers: reply.headers.filter(([k]) => !["set-cookie", "content-encoding", "content-length"].includes(k.toLowerCase())),
		savedAt: Math.floor(Date.now() / 1000),
	};
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

/** A response with `reply`'s parts. `Response`'s own `url` is read-only, so it's set on the instance. */
function make(reply: Reply, url: string): Response {
	// A status with no body (204, 304) can't be given one.
	const empty = [101, 204, 205, 304].includes(reply.status);
	const response = new Response(empty ? null : reply.body, { status: reply.status, statusText: reply.statusText, headers: reply.headers });
	Object.defineProperty(response, "url", { value: url, configurable: true });
	Object.defineProperty(response, "redirected", { value: reply.redirected, configurable: true });
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
