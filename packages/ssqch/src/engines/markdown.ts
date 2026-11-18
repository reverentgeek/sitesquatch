// Markdown, for `.md` files and the `markdown()` function.
//
// STAND-IN (stage 2 of the move to Node): this is markdown-it, as the spike core had it, so the
// core can build real sites and be measured. Stage 3 replaces it with ssqch's own Markdown and
// highlighter as a built-in `.wasm` (D2 in docs/node-migration.md), which gives 0.7's bytes; the
// options that only that engine has (heading attributes, alerts, containers, footnotes, definition
// lists, highlighting, render hooks) aren't here.
import markdownIt from "markdown-it";
import type { MarkdownOptions } from "../markdown-options.ts";
import type { TemplateEngine } from "./engine.ts";

export interface Markdown extends TemplateEngine {
	/** Markdown as HTML with the site's options, or without the `<p>` when `inline`. */
	html(text: string, inline: boolean): string;
	/**
	 * Renders the site's `_includes/hooks/<name>.*` template with `value` as `<name>` next to the
	 * global data, or answers `undefined` when the site has no such hook. Generators' files use it
	 * (a redirect page); the stand-in has no hooks.
	 */
	renderHook?(name: string, value: unknown, data: Record<string, any>): string | undefined | Promise<string | undefined>;
}

export function markdownEngine(options: MarkdownOptions): Markdown {
	const md = markdownIt({ html: true, linkify: options.autolinks, typographer: options.smartPunctuation });
	if (!options.indentedCode) md.disable("code");
	const slugger = options.sluggerFn;
	if (options.headingIds !== null || slugger) {
		// GitHub's heading ids: lowercase, punctuation dropped, spaces to dashes, repeats get -1, -2.
		md.core.ruler.push("ssqch_heading_ids", (state) => {
			const seen = new Map<string, number>();
			const tokens = state.tokens;
			for (let i = 0; i < tokens.length; i++) {
				if (tokens[i].type !== "heading_open" || tokens[i].attrGet("id")) continue;
				const text = (tokens[i + 1].children ?? []).filter((t) => t.type === "text" || t.type === "code_inline").map((t) => t.content).join("");
				let id = slugger ? String(slugger(text)) : [...text].map((c) => (c === " " ? "-" : /[\p{Alphabetic}\p{N}_-]/u.test(c) ? c.toLowerCase() : "")).join("");
				if (id === "") id = "section";
				const n = seen.get(id);
				seen.set(id, (n ?? 0) + 1);
				if (n !== undefined) id = `${id}-${n}`;
				tokens[i].attrSet("id", id);
			}
		});
	}
	return {
		render: (source) => md.render(source),
		html: (text, inline) => (inline ? md.renderInline(text) : md.render(text)),
	};
}
