// sitesquatch.dev's one script. Everything else is static files (wrangler.jsonc). It runs for
// /docs and /docs/* only (`run_worker_first`), and answers a request that would rather have
// Markdown (`Accept: text/markdown`, as Claude Code, Cursor and OpenCode send it) with the page's
// Markdown copy (llmsPlugin in ssqch.config.js). Its answers vary by `Accept`, so caches keep the two apart.

/** Whether `accept` prefers text/markdown to text/html, by their q values (a missing one is 1). */
function prefersMarkdown(accept) {
	const q = (type) => {
		for (const part of accept.split(",")) {
			const [name, ...params] = part.trim().split(";").map((s) => s.trim().toLowerCase());
			if (name !== type) continue;
			const value = params.find((p) => p.startsWith("q="));
			return value === undefined ? 1 : Number(value.slice(2)) || 0;
		}
		return 0;
	};
	const markdown = q("text/markdown");
	return markdown > 0 && markdown >= q("text/html");
}

/** The Markdown copy of a docs page's path: `/docs/install/` is `/docs/install.md`, `/docs/` is `/docs.md`. */
function copyOf(pathname) {
	const trimmed = pathname.replace(/\/+$/, "");
	return `${trimmed}.md`;
}

/** `response`, with `Vary: Accept` added. */
function varying(response) {
	const out = new Response(response.body, response);
	out.headers.append("Vary", "Accept");
	return out;
}

export default {
	async fetch(request, env) {
		const url = new URL(request.url);
		// A file of its own (a .md copy, an image) is what it is.
		const page = !/\.[a-z0-9]+$/i.test(url.pathname);
		if (page && prefersMarkdown(request.headers.get("Accept") ?? "")) {
			const copy = await env.ASSETS.fetch(new URL(copyOf(url.pathname), url));
			if (copy.ok) {
				const out = varying(copy);
				out.headers.set("Content-Type", "text/markdown; charset=utf-8");
				return out;
			}
		}
		const response = await env.ASSETS.fetch(request);
		return page ? varying(response) : response;
	},
};
