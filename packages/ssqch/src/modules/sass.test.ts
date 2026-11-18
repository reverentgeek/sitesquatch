import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { BUILTINS } from "../config.ts";
import type { Config } from "../config.ts";
import { realPath } from "../paths.ts";
import { filesRead } from "../plugin-files.ts";
import "./sass.ts";

function site(files: Record<string, string>): string {
	const root = realPath(fs.mkdtempSync(path.join(os.tmpdir(), "ssqch-sass-")));
	for (const [file, text] of Object.entries(files)) {
		fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
		fs.writeFileSync(path.join(root, file), text);
	}
	return root;
}

async function plugin(root: string, options: unknown, settings: Partial<Config> = {}) {
	const config = { root, env: "production", serving: false, base: "", watch: [], fileBuilders: [], summaries: [], ...settings } as unknown as Config;
	await BUILTINS.get("ssqch/sass")!(config, options as never);
	const build = async () => {
		const files = await config.fileBuilders[0][1](config);
		return Object.fromEntries(files.map((f) => [f.path, f.contents]));
	};
	const summary = () => config.summaries[0][1](config);
	return { config, build, summary };
}

const SITE = {
	"styles/app.scss": "@use \"colors\";\n@use \"trail\";\nbody { color: colors.$pine; a { color: red; } }\n",
	"styles/_colors.scss": "$pine: #01796f;\n",
	"styles/pages/blog.scss": ".post { margin: 0 auto; background: url(/img/pine.png); }\n",
	"vendor/_trail.scss": ".trail { margin: 0; }\n",
	"print.sass": "body\n  font-size: 12pt\n",
};

test("folders and files compile as 0.7 compiled them, partials only where they're used", async () => {
	const root = site(SITE);
	const { config, build, summary } = await plugin(root, { files: { styles: "/css", "print.sass": "/print/" }, loadPaths: ["vendor"] });
	assert.deepEqual(await build(), {
		"/css/app.css": ".trail{margin:0}body{color:#01796f}body a{color:red}",
		"/css/pages/blog.css": ".post{margin:0 auto;background:url(/img/pine.png)}",
		"/print/print.css": "body{font-size:12pt}",
	});
	assert.equal(summary(), "3 files (compressed)");
	// The files the build read, for `ssqch serve` to watch.
	assert.deepEqual(filesRead(config).map((f) => path.relative(root, f).split(path.sep).join("/")).sort(), ["print.sass", "styles/_colors.scss", "styles/app.scss", "styles/pages/blog.scss", "vendor/_trail.scss"]);
	// The folders 0.7 watched: each source, a file's folder, and the load paths.
	assert.deepEqual(config.watch, ["styles", "print.sass", "vendor"]);
	const files = await plugin(root, { files: { "styles/app.scss": "/app.css", "./print.sass": "/print.css" } });
	assert.deepEqual(files.config.watch, ["styles/app.scss", "styles", "./print.sass", "."]);
});

test("development builds are expanded, and a base goes in front of URLs from the root", async () => {
	const root = site(SITE);
	const { build, summary } = await plugin(root, { files: { "styles/pages/blog.scss": "/blog.css" } }, { env: "development", base: "/repo" } as Partial<Config>);
	assert.deepEqual(await build(), { "/blog.css": ".post {\n  margin: 0 auto;\n  background: url(/repo/img/pine.png);\n}\n" });
	assert.equal(summary(), "1 file (expanded)");
	const served = await plugin(root, { files: { "print.sass": "/print.css" } }, { serving: true } as Partial<Config>);
	assert.deepEqual(await served.build(), { "/print.css": "body {\n  font-size: 12pt;\n}\n" });
});

test("a mistake in a stylesheet names the file and the line", async () => {
	const root = site({ "styles/pages/blog.scss": ".post { color: $missing; }", "styles/app.scss": "@use \"nope\";\n" });
	const { build } = await plugin(root, { files: { "styles/pages/blog.scss": "/blog.css" } });
	await assert.rejects(build, { message: "compiling ./styles/pages/blog.scss: ./styles/pages/blog.scss: Error: Undefined variable.\n  ╷\n1 │ .post { color: $missing; }\n  │                ^^^^^^^^\n  ╵\n./styles/pages/blog.scss:1:16\n" });
	const app = await plugin(root, { files: { "styles/app.scss": "/app.css" } });
	await assert.rejects(app.build, (e: Error) => e.message.startsWith("compiling ./styles/app.scss: ./styles/app.scss: Error: Can't find stylesheet to import."));
	// The wasm still works after an error.
	fs.writeFileSync(path.join(root, "styles/pages/blog.scss"), ".post { color: red; }");
	assert.deepEqual(await build(), { "/blog.css": ".post{color:red}" });
});

test("its options are checked with 0.7's messages", async () => {
	const root = site(SITE);
	const fails = async (options: unknown, message: string) => assert.rejects(async () => plugin(root, options), { message });
	await fails({}, "files is required: { \"src/scss\": \"/css\" } or { \"src/app.scss\": \"/app.css\" }");
	await fails({ file: {} }, "unknown option \"file\" (did you mean \"files\"?) (options: files, style, loadPaths)");
	await fails({ files: ["styles"] }, "files must be an object of { source: \"/output\" }");
	await fails({ files: { styles: 1 } }, "files.styles: the output must be a URL path string");
	await fails({ files: { styles: "css" } }, "files: \"css\" must be a URL path starting with / (like \"/css/app.css\" or \"/css\")");
	await fails({ files: { styles: "/../css" } }, "files: \"/../css\" must be a URL path starting with / (like \"/css/app.css\" or \"/css\")");
	await fails({ files: { "": "/css" } }, "files: a source path can't be empty");
	await fails({ files: { styles: "/css" }, style: "nested" }, "style must be \"compressed\" or \"expanded\", not \"nested\"");
	await fails({ files: { styles: "/css" }, loadPaths: "vendor" }, "loadPaths must be an array of strings");
	const missing = await plugin(root, { files: { nope: "/css" } });
	await assert.rejects(missing.build, { message: "files: nope doesn't exist" });
	const css = site({ "plain.css": "a{}" });
	await assert.rejects((await plugin(css, { files: { "plain.css": "/plain.css" } })).build, { message: "files: plain.css isn't a .scss or .sass file" });
});

// opensource.guide (osg #9, #10): its stylesheet starts with Jekyll's empty front matter, and
// imports primer from node_modules by names with `.scss` (`@import "primer-core/index.scss"`),
// as primer's own files import each other. grass looked for those only beside the importer.
test("jekyll_front_matter_and_load_path_imports_that_name_their_extension", async () => {
	const root = site({
		"assets/css/index.scss": "---\n---\n\n@import \"primer-core/index.scss\";\n@import \"custom.scss\";\n",
		"assets/css/custom.scss": ".custom { color: red; }\n",
		"node_modules/primer-core/index.scss": "@import \"primer-support/index.scss\";\n.core { margin: 0; }\n",
		"node_modules/primer-support/index.scss": "@import \"lib/variables.scss\";\n.support { padding: $space; }\n",
		"node_modules/primer-support/lib/_variables.scss": "$space: 4px;\n",
	});
	const { build } = await plugin(root, { files: { "assets/css/index.scss": "/assets/css/index.css" }, loadPaths: ["node_modules"] });
	assert.deepEqual(await build(), { "/assets/css/index.css": ".support{padding:4px}.core{margin:0}.custom{color:red}" });
	// The front matter's lines stay, blank, so an error's line is the file's.
	fs.writeFileSync(path.join(root, "assets/css/index.scss"), "---\ntitle: x\n---\n.a { color: $nope; }\n");
	await assert.rejects(build, (e: Error) => /index\.scss:4/.test(e.message));
});
