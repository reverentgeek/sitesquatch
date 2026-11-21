// sitesquatch.dev's one script. Everything else is static files (wrangler.jsonc). It runs for
// the pages that have a Markdown copy (`run_worker_first`), and answers a request that would
// rather have Markdown (`Accept: text/markdown`, as Claude Code, Cursor and OpenCode send it)
// with the page's copy (llmsPlugin in ssqch.config.js). Its answers vary by `Accept`, so caches
// keep the two apart. It's the code src/docs/serving-markdown.md gives people to paste, as it is
// there (tests/serving-markdown.test.ts keeps them the same).

/** Whether `accept` asks for text/markdown by name, at least as much as for HTML (by q-values). */
function prefersMarkdown(accept) {
  const q = new Map();
  for (const part of accept.split(",")) {
    const [type, ...params] = part.split(";").map((p) => p.trim().toLowerCase());
    const given = params.find((p) => p.startsWith("q="));
    if (type) q.set(type, given === undefined ? 1 : Number(given.slice(2)) || 0);
  }
  const markdown = q.get("text/markdown") ?? 0;
  return markdown > 0 && markdown >= (q.get("text/html") ?? q.get("text/*") ?? q.get("*/*") ?? 0);
}

/** A page's Markdown copy, as llmsPlugin() writes it: `/guide/intro/` (or `/guide/intro`) is `/guide/intro/index.md`, `/about.html` is `/about.md`; a file of another kind has none. */
function copyOf(pathname) {
  if (pathname.endsWith("/")) return `${pathname}index.md`;
  if (/\.html?$/.test(pathname)) return pathname.replace(/\.html?$/, ".md");
  return /\.[a-z0-9]+$/i.test(pathname) ? undefined : `${pathname}/index.md`;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const copy = copyOf(url.pathname);
    if (copy && prefersMarkdown(request.headers.get("Accept") ?? "")) {
      const found = await env.ASSETS.fetch(new URL(copy, url));
      if (found.ok) {
        const out = new Response(found.body, found);
        out.headers.set("Content-Type", "text/markdown; charset=utf-8");
        out.headers.set("Link", `<${url.origin}${url.pathname}>; rel="canonical"`);
        out.headers.append("Vary", "Accept");
        return out;
      }
    }
    const response = await env.ASSETS.fetch(request);
    if (!copy) return response;
    const out = new Response(response.body, response);
    out.headers.append("Vary", "Accept");
    return out;
  },
};
