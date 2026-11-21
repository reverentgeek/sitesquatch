// `ssqch/from-jekyll`: what a Jekyll site's templates and Markdown expect, for a site moving
// from Jekyll, as one plugin. `templates` gives templates Jekyll's `page` (front matter too) and
// `site` (`site.posts`, each collection, `site.data`, `site.categories`), so a Jekyll site's
// layouts and includes run as written (src/jekyll.ts builds them). `kramdown` is kramdown's
// habits, each a default under the site's own `markdown` options: Markdown inside HTML with
// `markdown="1"`, its heading ids, smart quotes, and no links made from bare URLs.
import { BUILTINS } from "../config.ts";
import type { Config } from "../config.ts";
import { applyMarkdownOptions } from "../markdown-options.ts";
import { Options } from "./options.ts";

export function fromJekyll(options: Record<string, unknown> = {}) {
	return { name: "fromJekyll", builtin: "ssqch/from-jekyll", options };
}

/** kramdown's Markdown, for what the site's `markdown` doesn't set itself. */
export const KRAMDOWN_DEFAULTS = { htmlMarkdown: "kramdown", headingIds: "kramdown", smartPunctuation: true, autolinks: false } as const;

BUILTINS.set("ssqch/from-jekyll", (config: Config, given) => {
	const o = new Options(given, ["templates", "kramdown"]);
	if (o.bool("kramdown") ?? true) {
		const own = Object.fromEntries(Object.entries(KRAMDOWN_DEFAULTS).filter(([key]) => !config.markdownGiven.has(key)));
		if (Object.keys(own).length) applyMarkdownOptions(config.markdown, own, "module");
	}
	if (o.bool("templates") ?? true) config.jekyllTemplates = true;
});
