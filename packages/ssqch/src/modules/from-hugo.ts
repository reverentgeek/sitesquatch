// `ssqch/from-hugo`: Hugo's shortcodes, for a site moving from Hugo, as one plugin. A shortcode
// on a line of its own (`{{< note >}}` to `{{< /note >}}`) is a container, rendered by
// `_includes/containers/<name>.*`, and one inside a line of text is the same template in its place
// (`container.inline`), as `markdown: { shortcodes: "hugo" }` reads them: a default under the
// site's own `markdown` options.
import { BUILTINS } from "../config.ts";
import type { Config } from "../config.ts";
import { applyMarkdownOptions } from "../markdown-options.ts";
import { Options } from "./options.ts";

export function fromHugo(options: Record<string, unknown> = {}) {
	return { name: "fromHugo", builtin: "ssqch/from-hugo", options };
}

BUILTINS.set("ssqch/from-hugo", (config: Config, given) => {
	new Options(given, []);
	if (!config.markdownGiven.has("shortcodes")) applyMarkdownOptions(config.markdown, { shortcodes: "hugo" });
});
