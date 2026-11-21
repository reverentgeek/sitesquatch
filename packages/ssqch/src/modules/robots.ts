// `ssqch/robots`: `robots.txt`, the sign at the trailhead. It says where the sitemap is (the
// address `sitemapPlugin()` has), which paths no crawler should read, and what AI crawlers may
// do, by what they're for: collecting pages to train models on, indexing them for an AI search,
// and fetching one because a person asked about it. A site picks per purpose, not per company,
// and the table below keeps up with the names.
import { BUILTINS } from "../config.ts";
import type { Config } from "../config.ts";
import { bail } from "../diagnostics.ts";
import { Options } from "./options.ts";
import { debugString } from "./plugin-util.ts";

export function robotsPlugin(options: Record<string, unknown> = {}) {
	return { name: "ssqch/robots", builtin: "ssqch/robots", options };
}

/** What an AI crawler is for. */
export type Purpose = "training" | "search" | "fetch";

/**
 * The AI crawlers' robots.txt tokens, by purpose, as checked on 2026-11-21: from each company's own
 * documentation, or specification.website's list where that's the source read. A fetch a person asked for may not read robots.txt at all (OpenAI's and
 * Perplexity's say so); the line still says what the site wants.
 */
export const CRAWLERS: ReadonlyArray<{ token: string; purpose: Purpose; who: string; source: string }> = [
	{ token: "GPTBot", purpose: "training", who: "OpenAI", source: "https://developers.openai.com/api/docs/bots" },
	{ token: "ClaudeBot", purpose: "training", who: "Anthropic", source: "https://support.claude.com/en/articles/8896518" },
	{ token: "Google-Extended", purpose: "training", who: "Google (Gemini; Search isn't affected)", source: "https://specification.website/spec/agent-readiness/robots-for-ai-crawlers/" },
	{ token: "Applebot-Extended", purpose: "training", who: "Apple (Apple Intelligence; Siri and Spotlight aren't affected)", source: "https://specification.website/spec/agent-readiness/robots-for-ai-crawlers/" },
	{ token: "CCBot", purpose: "training", who: "Common Crawl", source: "https://commoncrawl.org/ccbot" },
	{ token: "meta-externalagent", purpose: "training", who: "Meta", source: "https://developers.facebook.com/docs/sharing/webmasters/web-crawlers" },
	{ token: "Bytespider", purpose: "training", who: "ByteDance", source: "https://specification.website/spec/agent-readiness/robots-for-ai-crawlers/" },
	{ token: "OAI-SearchBot", purpose: "search", who: "OpenAI (ChatGPT search)", source: "https://developers.openai.com/api/docs/bots" },
	{ token: "Claude-SearchBot", purpose: "search", who: "Anthropic", source: "https://support.claude.com/en/articles/8896518" },
	{ token: "PerplexityBot", purpose: "search", who: "Perplexity", source: "https://docs.perplexity.ai/docs/resources/perplexity-crawlers" },
	{ token: "ChatGPT-User", purpose: "fetch", who: "OpenAI", source: "https://developers.openai.com/api/docs/bots" },
	{ token: "Claude-User", purpose: "fetch", who: "Anthropic", source: "https://support.claude.com/en/articles/8896518" },
	{ token: "Perplexity-User", purpose: "fetch", who: "Perplexity", source: "https://docs.perplexity.ai/docs/resources/perplexity-crawlers" },
	{ token: "meta-externalfetcher", purpose: "fetch", who: "Meta", source: "https://developers.facebook.com/docs/sharing/webmasters/web-crawlers" },
];

const PURPOSES: readonly Purpose[] = ["training", "search", "fetch"];

/** robots.txt for these settings: everyone's group (the paths no crawler reads), a group for each AI purpose that's turned off, then the sitemap. */
export function robotsTxt(disallow: readonly string[], ai: Record<Purpose, boolean>, sitemap: string | undefined): string {
	const lines = ["User-agent: *", ...(disallow.length ? disallow.map((p) => `Disallow: ${p}`) : ["Allow: /"])];
	for (const purpose of PURPOSES) {
		if (ai[purpose]) continue;
		// A crawler that has a group of its own reads only that group, so `Disallow: /` is all it needs.
		lines.push("", ...CRAWLERS.filter((c) => c.purpose === purpose).map((c) => `User-agent: ${c.token}`), "Disallow: /");
	}
	if (sitemap) lines.push("", `Sitemap: ${sitemap}`);
	return `${lines.join("\n")}\n`;
}

BUILTINS.set("ssqch/robots", (config: Config, given) => {
	const o = new Options(given, ["ai", "disallow", "sitemap"]);
	const disallow = o.list("disallow") ?? [];
	for (const p of disallow) if (!p.startsWith("/")) bail(`disallow: ${debugString(p)} must be a URL path starting with /, like "/drafts/"`);
	const ai: Record<Purpose, boolean> = { training: true, search: true, fetch: true };
	const given_ = o.get("ai");
	if (given_ !== undefined) {
		if (typeof given_ !== "object" || given_ === null || Array.isArray(given_)) bail("ai must be an object, like { training: false, search: true, fetch: true }");
		for (const [key, value] of Object.entries(given_ as Record<string, unknown>)) {
			if (!(PURPOSES as readonly string[]).includes(key)) bail(`ai: unknown purpose "${key}" (purposes: ${PURPOSES.join(", ")})`);
			if (typeof value !== "boolean") bail(`ai.${key} must be true or false`);
			ai[key as Purpose] = value;
		}
	}
	// `sitemap: false` leaves the line out; a string is another sitemap's address.
	const sitemap = o.get("sitemap");
	if (sitemap !== undefined && typeof sitemap !== "boolean" && !(typeof sitemap === "string" && /^https?:\/\//.test(sitemap))) bail(`sitemap must be true, false or the sitemap's whole address, like "https://example.com/sitemap.xml" (got ${debugString(sitemap as string)})`);

	config.generators.push(["ssqch/robots", (config) => {
		// The site's own robots.txt and this plugin would be two signs on one post. (A page that
		// writes /robots.txt is caught where generators' files are written.)
		const named = (v: unknown): boolean => (typeof v === "string" ? /(^|\/)robots\.txt$/.test(v) : v !== null && typeof v === "object" && Object.entries(v).some(([k, x]) => named(k) || named(x)));
		if (config.passthrough.some(named)) bail("the site copies its own robots.txt (passthrough) and robotsPlugin() writes one: keep one of them. robotsPlugin() writes the sitemap line, `disallow` and the AI crawlers' groups (`ssqch docs robotsPlugin`)");
		let line: string | undefined;
		if (typeof sitemap === "string") line = sitemap;
		else if (sitemap !== false && config.sitemap) line = config.sitemap();
		else if (sitemap === true) bail("sitemap: true needs sitemapPlugin({ url }) in the config, for the sitemap's address (or give the address: sitemap: \"https://example.com/sitemap.xml\")");
		// The paths are the site's, so they get `base` as every other URL does.
		const base = config.base.replace(/\/$/, "");
		return [{ path: "/robots.txt", contents: robotsTxt(disallow.map((p) => base + p), ai, line) }];
	}]);
});
