// `ssqch/from-vitepress`: VitePress's Markdown, for a site moving from VitePress, as one plugin.
// Its pages move as they are and its theme's CSS finds its classes (engines/vitepress-dialect.ts
// has what each part does). It's a plugin of the kind any site can write: Markdown steps before
// and after ssqch's, built-in render hooks a site's own template replaces, and defaults under the
// site's own `markdown` options (VitePress's heading ids and email autolinks).
import { VITEPRESS_HOOKS, vitepressAfter, vitepressBefore } from "../engines/vitepress-dialect.ts";
import { BUILTINS } from "../config.ts";
import type { Config } from "../config.ts";
import { addMarkdownSteps, applyMarkdownOptions } from "../markdown-options.ts";
import type { HookFn } from "../markdown-options.ts";
import { Options } from "./options.ts";

/** The plugin's Markdown part: what `fromVitepress()` and the old `dialect: "vitepress"` both turn on. */
export function vitepressMarkdown(): { before: (source: string) => string; after: (html: string) => string; hooks: Record<string, HookFn> } {
	const hooks: Record<string, HookFn> = {};
	for (const [name, hook] of Object.entries(VITEPRESS_HOOKS)) hooks[name] = (value, context) => hook(value, { htmlUrls: context.urls === "html" });
	return { before: vitepressBefore, after: vitepressAfter, hooks };
}

/** VitePress's markdown-it settings, for what the site doesn't set itself. */
export const VITEPRESS_DEFAULTS = { headingIds: "vitepress", autolinks: "email" } as const;

export function fromVitepress(options: Record<string, unknown> = {}) {
	return { name: "fromVitepress", builtin: "ssqch/from-vitepress", options };
}

BUILTINS.set("ssqch/from-vitepress", (config: Config, given) => {
	new Options(given, []);
	addMarkdownSteps(config.markdown.steps, 'plugin "fromVitepress"', vitepressMarkdown());
	const own = Object.fromEntries(Object.entries(VITEPRESS_DEFAULTS).filter(([key]) => !config.markdownGiven.has(key)));
	if (Object.keys(own).length) applyMarkdownOptions(config.markdown, own, "module");
	// vuePlugin(), listed before or after, gives components VitePress's `useData()`, `@theme/` and loaders.
	config.vitepress = true;
});
