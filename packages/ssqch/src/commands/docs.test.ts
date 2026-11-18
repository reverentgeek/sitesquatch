import { test } from "node:test";
import assert from "node:assert/strict";
import { sections } from "./docs.ts";

test("a line that's only an image is left out of a section, and the same line in a code block isn't", () => {
	const readme = [
		"# Camp",
		"",
		"<img align=\"right\" src=\"docs/assets/stickers/tent.svg\" alt=\"\" width=\"96\">",
		"<p align=\"center\"><img src=\"docs/assets/stickers/sitesquatch.svg\" alt=\"SiteSquatch\" width=\"160\"></p>",
		"Pitch the tent before dark.",
		"",
		"```html",
		"<img src=\"/pine.png\" alt=\"A pine\">",
		"```",
		"An `<img>` in a sentence stays.",
	].join("\n");
	const [camp] = sections(readme);
	assert.equal(camp.title, "Camp");
	assert.equal(camp.body, "Pitch the tent before dark.\n\n```html\n<img src=\"/pine.png\" alt=\"A pine\">\n```\nAn `<img>` in a sentence stays.");
});
