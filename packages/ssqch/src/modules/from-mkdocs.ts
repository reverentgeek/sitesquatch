// `ssqch/from-mkdocs`: MkDocs' Markdown and, with `templates`, what MkDocs gives a theme's
// templates, for a site moving from MkDocs, as one plugin. The Markdown is Python-Markdown's
// (raw HTML blocks to their closing tag, lists at four spaces, toc's ids), Material's and
// pymdownx's admonitions and tabs, and `.md` links from the page, each a default under the site's
// own `markdown` options. `templates: true` is mkdocs.yml's context for an MkDocs theme's Jinja
// (`config`, `nav`, `page`, `base_url`, the `url` filter, `main.html` as a page's layout, the
// theme's 404), which src/mkdocs.ts builds.
import { BUILTINS, addMkdocsTheme } from "../config.ts";
import type { Config } from "../config.ts";
import { bail } from "../diagnostics.ts";
import { applyMarkdownOptions } from "../markdown-options.ts";
import { Options } from "./options.ts";
import { debugString } from "./plugin-util.ts";

export function fromMkdocs(options: Record<string, unknown> = {}) {
	return { name: "fromMkdocs", builtin: "ssqch/from-mkdocs", options };
}

/** MkDocs' Markdown, for what the site's `markdown` doesn't set itself. */
export const MKDOCS_DEFAULTS = { dialect: "python-markdown", admonitions: "mkdocs", tabs: "mkdocs", headingIds: "python-markdown", sourceLinks: "relative" } as const;

/** Turns on MkDocs' context for templates, from the mkdocs.yml at `file` (from the root). */
export function mkdocsTemplates(config: Config, file: string): void {
	config.mkdocsTemplates = file;
	addMkdocsTheme(config);
}

BUILTINS.set("ssqch/from-mkdocs", (config: Config, given) => {
	const o = new Options(given, ["config", "templates"]);
	const file = o.string("config") ?? "mkdocs.yml";
	if (file.trim() === "") bail(`config must be the path of an mkdocs.yml, like "docs/mkdocs.yml" (got ${debugString(file)})`);
	const own = Object.fromEntries(Object.entries(MKDOCS_DEFAULTS).filter(([key]) => !config.markdownGiven.has(key)));
	if (Object.keys(own).length) applyMarkdownOptions(config.markdown, own, "module");
	if (o.bool("templates")) mkdocsTemplates(config, file);
});
