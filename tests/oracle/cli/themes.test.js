// From crates/ssqch/tests/cli.rs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { ssqch, tempDir, write, read, exists } from "../lib/ssqch.js";

test("a_theme_sits_under_the_site_file_by_file", () => {
	const dir = tempDir("theme");
	const d = dir;
	// The theme: layouts in three engines, a partial, a hook, a container, data, a page and a stylesheet.
	write(dir, {
		"themes/trail/_includes/base.edge": "<html><head><link rel=\"stylesheet\" href=\"/assets/theme.css\"></head><body>\n@include('partials/header')\n<main>{{{ content }}}</main>\n@include('partials/footer')\n</body></html>",
		"themes/trail/_includes/partials/header.edge": "<header>{{ site.name }} ({{ site.tagline }})</header>",
		"themes/trail/_includes/partials/footer.edge": "<footer>theme footer</footer>",
		"themes/trail/_includes/post.njk": "---\nlayout: base.edge\n---\n<article>{% include \"byline.njk\" %}{{ content | safe }}</article>",
		"themes/trail/_includes/byline.njk": "<p>theme byline</p>",
		"themes/trail/_includes/card.liquid": "<div class=\"card\">{% include \"card-title.liquid\" %}{{ content }}</div>",
		"themes/trail/_includes/card-title.liquid": "<b>theme title</b>",
		"themes/trail/_includes/hooks/heading.edge": "<h{{ heading.level }} class=\"theme\">{{{ heading.content }}}</h{{ heading.level }}>",
		"themes/trail/_includes/containers/note.edge": "<aside class=\"theme-note\">{{{ container.content }}}</aside>",
		"themes/trail/_data/site.json": "{ \"name\": \"Theme Name\", \"tagline\": \"from the theme\" }",
		"themes/trail/404.md": "---\nlayout: base.edge\npermalink: /404.html\n---\nTheme 404\n",
		"themes/trail/about.md": "---\nlayout: base.edge\n---\nTheme about\n",
		"themes/trail/assets/theme.css": "body { color: green }",
		"themes/trail/assets/logo.svg": "<svg/>",
		"themes/trail/README.md": "# Trail theme\n",
		"themes/trail/LICENSE": "MIT",
		// The site: its own name, footer, byline, about page and logo.
		"ssqch.config.js": "export default { dirs: { input: \"src\", output: \"dist\" }, templateFormats: [\"edge\", \"md\", \"njk\", \"liquid\"], theme: \"themes/trail\" };\n",
		"src/_data/site.json": "{ \"name\": \"My Site\" }",
		"src/_includes/partials/footer.edge": "<footer>my footer</footer>",
		"src/_includes/byline.njk": "<p>my byline</p>",
		"src/index.md": "---\nlayout: post.njk\n---\n## Hello\n\n::: note\nNoted.\n:::\n",
		"src/card.liquid": "---\nlayout: card.liquid\n---\nCard body",
		"src/about.md": "---\nlayout: base.edge\n---\nMy about\n",
		"src/assets/logo.svg": "<svg id=\"mine\"/>",
	});
	let r = ssqch(["build", "--root", d, "-q"]);
	assert.ok(r.ok, r.log);
	const out = (p) => read(dir, `dist/${p}`);
	assert.equal(
		out("index.html"),
		"<html><head><link rel=\"stylesheet\" href=\"/assets/theme.css\"></head><body><header>My Site (from the theme)</header>\n<main><article><p>my byline</p><h2 class=\"theme\">Hello</h2>\n<aside class=\"theme-note\"><p>Noted.</p>\n</aside>\n</article></main><footer>my footer</footer>\n</body></html>",
	);
	assert.equal(out("card/index.html"), "<div class=\"card\"><b>theme title</b>Card body</div>");
	assert.ok(out("404.html").includes("<main><p>Theme 404</p>\n</main>"), out("404.html"));
	assert.ok(out("about/index.html").includes("My about") && !out("about/index.html").includes("Theme about"));
	assert.equal(out("assets/theme.css"), "body { color: green }");
	// The site has its own logo (and no passthrough for it), so the theme's isn't copied over it.
	assert.ok(!exists(dir, "dist/assets/logo.svg"));
	for (const notBuilt of ["README/index.html", "readme/index.html", "LICENSE", "themes"]) {
		assert.ok(!exists(dir, `dist/${notBuilt}`), `${notBuilt} was built`);
	}

	// The folder is named as the system names paths: 0.7 kept the config's `/` on Windows, and
	// the Node build joins with `\` there, as node:path does (the changelog records it).
	write(dir, { "ssqch.config.js": "export default { theme: \"themes/missing\" };\n" });
	r = ssqch(["build", "--root", d, "-q"]);
	assert.ok(!r.ok && r.log.includes("ssqch.config.js: theme folder") && /themes[\\/]missing doesn't exist/.test(r.log), r.log);
	write(dir, { "ssqch.config.js": "export default { theme: \"https://github.com/you/theme\" };\n" });
	r = ssqch(["build", "--root", d, "-q"]);
	assert.ok(!r.ok && r.log.includes("isn't pinned: add the commit or tag to use"), r.log);
});

test("a_theme_from_git_is_fetched_once", () => {
	const git = (dir, args) => {
		const out = spawnSync("git", ["-C", dir, "-c", "user.name=Squatch", "-c", "user.email=squatch@example.com", "-c", "commit.gpgsign=false", ...args], { encoding: "utf8" });
		assert.equal(out.status, 0, `git ${JSON.stringify(args)}: ${out.stderr}`);
		return out.stdout.trim();
	};
	// A repository with the theme in a folder, tagged.
	const repo = tempDir("theme-repo");
	write(repo, { "theme/_includes/base.edge": "<main class=\"v1\">{{{ content }}}</main>" });
	git(repo, ["init", "--quiet", "-b", "main"]);
	git(repo, ["add", "."]);
	git(repo, ["commit", "--quiet", "-m", "Theme"]);
	git(repo, ["tag", "v1.0.0"]);
	write(repo, { "theme/_includes/base.edge": "<main class=\"v2\">{{{ content }}}</main>" });
	git(repo, ["commit", "--quiet", "-am", "Change it"]);
	// `file:///C:/...` on Windows, `file:///tmp/...` elsewhere.
	const repoPath = repo.replaceAll("\\", "/");
	const url = `file://${repoPath.startsWith("/") ? "" : "/"}${repoPath}`;

	const dir = tempDir("theme-git");
	const d = dir;
	write(dir, {
		"ssqch.config.js": `export default { dirs: { input: "src", output: "dist" }, theme: { git: "${url}", ref: "v1.0.0", dir: "theme" } };\n`,
		"src/index.md": "---\nlayout: base.edge\n---\nHi\n",
	});
	let r = ssqch(["build", "--root", d]);
	assert.ok(r.ok, r.log);
	assert.ok(r.log.includes(`[ssqch] Fetching theme ${url}#v1.0.0`), r.log);
	// The tag's version, not the branch's.
	assert.equal(read(dir, "dist/index.html"), "<main class=\"v1\"><p>Hi</p>\n</main>");

	// It's kept: the next build doesn't need the repository.
	// (Renamed rather than deleted: git's object files are read-only, which Windows minds.)
	fs.renameSync(repo, path.join(tempDir("theme-repo-moved"), "repo"));
	r = ssqch(["build", "--root", d]);
	assert.ok(r.ok, r.log);
	assert.ok(!r.log.includes("Fetching theme"), r.log);

	// The same thing as one string, and a ref that doesn't exist.
	write(dir, { "ssqch.config.js": `export default { dirs: { input: "src", output: "dist" }, theme: "${url}#v1.0.0:theme" };\n` });
	r = ssqch(["build", "--root", d, "-q"]);
	assert.ok(r.ok, r.log);
	write(dir, { "ssqch.config.js": `export default { theme: "${url}#v9" };\n` });
	r = ssqch(["build", "--root", d, "-q"]);
	assert.ok(!r.ok && r.log.includes("#v9: git fetch failed"), r.log);
});
