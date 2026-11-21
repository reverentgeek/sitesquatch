// Added in 0.13 (the audit's plan, step 3): `ssqch patrol` reads a build for what agents and
// crawlers read. It reads any folder, needs no config, and exits 0 when it's clear, 1 when it
// warns and 2 on an error.
import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { project, read, ssqch, write } from "../lib/ssqch.js";

test("patrol_finds_a_site_with_the_agent_plugins_clear", () => {
	const dir = project({
		"ssqch.config.js": [
			"import { llmsPlugin } from \"ssqch/llms\";",
			"import { robotsPlugin } from \"ssqch/robots\";",
			"import { sitemapPlugin } from \"ssqch/sitemap\";",
			"export default { data: { layout: \"base.jinja\" }, plugins: [sitemapPlugin({ url: \"https://trail.example\" }), robotsPlugin(), llmsPlugin({ url: \"https://trail.example\" })] };",
		].join("\n"),
		"_includes/base.jinja": "<html><head><meta name=\"description\" content=\"{{ description }}\">{% if markdownCopy(page.url) %}<link rel=\"alternate\" type=\"text/markdown\" href=\"{{ markdownCopy(page.url) }}\">{% endif %}</head><body><main>{{ content | safe }}</main></body></html>",
		"index.md": "---\ndescription: The trails.\n---\n# Trail Guide\n\nPine cones fall along the Cedar trail, and the rangers count them every morning before the hikers come.\n",
		"404.md": "---\npermalink: /404.html\ndescription: Lost.\n---\n# Off the trail\n",
	}, "patrol");
	assert.ok(ssqch(["build", "--root", dir, "-q"]).ok);
	const r = ssqch(["patrol", "--root", dir]);
	assert.equal(r.code, 0, r.log);
	assert.ok(r.stdout.startsWith("Patrol of _site: 1 page, 1 with a Markdown copy\n  robots.txt posted, sitemap posted, llms.txt posted, 404.html posted\n"), r.stdout);
	assert.ok(r.stdout.includes("All clear: nothing on the trail for an agent to trip on."), r.stdout);
});

test("patrol_warns_with_codes_and_reads_any_folder", () => {
	const dir = project({ "_site/index.html": "<html><body><p>No heading, no main.</p></body></html>" }, "patrol-bare");
	const r = ssqch(["patrol", path.join(dir, "_site"), "--format", "json"]);
	assert.equal(r.code, 1, r.log);
	const report = JSON.parse(r.stdout);
	assert.deepEqual(report.warnings.map((w) => w.code), ["no-robots", "no-sitemap", "no-404", "no-llms", "no-h1", "no-description", "no-main"]);
	assert.deepEqual(report.warnings.find((w) => w.code === "no-h1").files, ["index.html"]);
	const text = ssqch(["patrol", path.join(dir, "_site")]);
	assert.ok(text.stdout.includes("warn[no-llms]: no llms.txt") && text.stdout.includes("`ssqch docs \"what patrol checks\"`"), text.stdout);
	const missing = ssqch(["patrol", path.join(dir, "nope")]);
	assert.equal(missing.code, 2, missing.log);
	assert.ok(missing.stderr.includes("isn't there: build the site first"), missing.stderr);
});

test("robots_plugin_writes_rules_by_purpose", () => {
	const dir = project({
		"ssqch.config.js": "import { robotsPlugin } from \"ssqch/robots\";\nimport { sitemapPlugin } from \"ssqch/sitemap\";\nexport default { base: \"/trail/\", plugins: [robotsPlugin({ ai: { training: false }, disallow: [\"/drafts/\"] }), sitemapPlugin({ url: \"https://example.com\" })] };\n",
		"index.md": "# Pine\n",
	}, "robots");
	assert.ok(ssqch(["build", "--root", dir, "-q"]).ok);
	assert.equal(read(dir, "_site/robots.txt"), "User-agent: *\nDisallow: /trail/drafts/\n\nUser-agent: GPTBot\nUser-agent: ClaudeBot\nUser-agent: Google-Extended\nUser-agent: Applebot-Extended\nUser-agent: CCBot\nUser-agent: meta-externalagent\nUser-agent: Bytespider\nDisallow: /\n\nSitemap: https://example.com/trail/sitemap.xml\n");
	for (const [options, says] of [
		["{ ai: { trainning: false } }", "ai: unknown purpose \"trainning\" (purposes: training, search, fetch)"],
		["{ disallow: [\"drafts\"] }", "disallow: \"drafts\" must be a URL path starting with /"],
		["{ sitemap: true }", "sitemap: true needs sitemapPlugin({ url }) in the config"],
	]) {
		write(dir, { "ssqch.config.js": `import { robotsPlugin } from "ssqch/robots";\nexport default { plugins: [robotsPlugin(${options})] };\n` });
		const r = ssqch(["build", "--root", dir]);
		assert.ok(!r.ok && r.log.includes(says), r.log);
	}
	// Its own robots.txt and the plugin: one sign per post.
	write(dir, { "ssqch.config.js": "import { robotsPlugin } from \"ssqch/robots\";\nexport default { passthrough: [\"robots.txt\"], plugins: [robotsPlugin()] };\n", "robots.txt": "User-agent: *\n" });
	const both = ssqch(["build", "--root", dir]);
	assert.ok(!both.ok && both.log.includes("the site copies its own robots.txt (passthrough) and robotsPlugin() writes one"), both.log);
});
