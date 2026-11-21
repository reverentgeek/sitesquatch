// `ssqch/from-vitepress`: VitePress's Markdown, for a site moving from VitePress, as one plugin.
// Its pages move as they are and its theme's CSS finds its classes (engines/vitepress-dialect.ts
// has what each part does). It's a plugin of the kind any site can write: Markdown steps before
// and after ssqch's, built-in render hooks a site's own template replaces, and defaults under the
// site's own `markdown` options (VitePress's heading ids, email autolinks, markdown-it's `:::`).
import { VITEPRESS_HOOKS, vitepressAfter, vitepressBefore } from "../engines/vitepress-dialect.ts";
import { bail } from "../diagnostics.ts";
import type { HookFn } from "../markdown-options.ts";

/** The plugin's Markdown part: what `fromVitepress()` and the old `dialect: "vitepress"` both turn on. */
export function vitepressMarkdown(): { before: (source: string) => string; after: (html: string) => string; hooks: Record<string, HookFn> } {
	const hooks: Record<string, HookFn> = {};
	for (const [name, hook] of Object.entries(VITEPRESS_HOOKS)) hooks[name] = (value, context) => hook(value, { htmlUrls: context.urls === "html" });
	return { before: vitepressBefore, after: vitepressAfter, hooks };
}

/** VitePress's markdown-it settings, for what the site doesn't set itself. */
export const VITEPRESS_DEFAULTS = { headingIds: "vitepress", autolinks: "email", containers: "markdown-it" } as const;

export function fromVitepress(options: Record<string, unknown> = {}) {
	if (options === null || typeof options !== "object" || Array.isArray(options)) bail("fromVitepress(): options must be an object");
	const key = Object.keys(options)[0];
	if (key !== undefined) bail(`fromVitepress(): this plugin takes no options (got "${key}"); the site's \`urls\` and \`markdown\` options set what it doesn't`);
	return { name: "fromVitepress", markdown: vitepressMarkdown(), defaults: { markdown: { ...VITEPRESS_DEFAULTS } } };
}
