// Lists the "Not released yet" notes in the documentation. sitesquatch.dev deploys from main, so
// it can describe a feature before it's on npm: that feature's documentation starts with
//
//   > [!NOTE]
//   > **Not released yet.** This ships with the next version of ssqch.
//
// and the release commit takes the notes out ("Releasing" in AGENTS.md, step 2). release.yml runs
// this with --check and refuses a tag while one is left, since the docs would then say a released
// feature isn't released, in the package (`ssqch docs`) and on the site.
//
//   node scripts/unreleased-notes.mjs [--check]
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const NOTE = /^>\s*\*\*Not released yet\.\*\*/;

/** The documentation's Markdown: the README, and the site's pages (the docs among them). */
function documentation() {
	const files = ["README.md"];
	const walk = (dir) => {
		let entries;
		try {
			entries = readdirSync(path.join(root, dir), { withFileTypes: true });
		} catch {
			return;
		}
		for (const entry of entries.sort((a, b) => (a.name < b.name ? -1 : 1))) {
			const file = `${dir}/${entry.name}`;
			if (entry.isDirectory() && entry.name !== "node_modules" && entry.name !== "dist") walk(file);
			else if (entry.name.endsWith(".md")) files.push(file);
		}
	};
	walk("site/src");
	return files;
}

const found = [];
for (const file of documentation()) {
	readFileSync(path.join(root, file), "utf8").split("\n").forEach((line, i) => {
		if (NOTE.test(line)) found.push(`${file}:${i + 1}`);
	});
}

for (const place of found) console.log(place);
if (process.argv.includes("--check") && found.length > 0) {
	console.error(`unreleased-notes: ${found.length} "Not released yet" note${found.length === 1 ? " is" : "s are"} still in the docs. Take ${found.length === 1 ? "it" : "them"} out in the release commit: the release ships what ${found.length === 1 ? "it describes" : "they describe"}.`);
	process.exit(1);
}
if (found.length === 0) console.log("unreleased-notes: no \"Not released yet\" notes in the docs");
