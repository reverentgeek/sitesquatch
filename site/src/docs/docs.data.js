// The docs pages: plain Markdown, which GitHub shows and `ssqch docs` prints as they are, so no
// template language runs in them (`render: md`). Each page's `command` is the `ssqch docs`
// command that prints it, and `source` is its file, for "Edit on GitHub".
import { commandOf } from "../../lib/docs.ts";

export default {
	layout: "doc.jinja",
	render: "md",
	computed: {
		file: (data) => data.page.inputPath.replace(/\\/g, "/").replace(/^.*?src\/docs\//, ""),
		command: (data) => commandOf({ file: data.page.inputPath.replace(/\\/g, "/").replace(/^.*?src\/docs\//, ""), title: data.title, command: data.command }),
		source: (data) => `site/src/docs/${data.page.inputPath.replace(/\\/g, "/").replace(/^.*?src\/docs\//, "")}`,
	},
};
