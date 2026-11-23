// The dev server: what holds an update (crates/sitesquatch/src/serve.rs), and the whole server
// run on small sites for what the oracle's tests don't reach.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { realPath } from "../paths.ts";
import { assetStamps } from "./live.ts";
import { QUIET, editorsOwn, settle } from "./server.ts";
import { Channel } from "./watch.ts";

const BIN = fileURLToPath(new URL("../../bin/ssqch.ts", import.meta.url));

function tempDir(name: string): string {
	return realPath(fs.mkdtempSync(path.join(os.tmpdir(), `ssqch-${name}-`)));
}

/** Removes a test's folder. On Windows a process that's ending can hold a file a moment longer: tried again, then left for the system to clear. */
function remove(dir: string): void {
	try { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }); } catch { /* left in the temporary folder */ }
}

function write(dir: string, files: Record<string, string>): void {
	for (const [rel, text] of Object.entries(files)) {
		fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
		fs.writeFileSync(path.join(dir, rel), text);
	}
}

const readOr = (file: string) => { try { return fs.readFileSync(file, "utf8"); } catch { return ""; } };

test("an_update_waits_for_the_tools_writes", async () => {
	const dir = tempDir("serve-settle");
	try {
		const css = path.join(dir, "css/styles.css");
		write(dir, { "css/styles.css": "a{}", "index.html": "home" });
		const rx = new Channel<string[]>();

		// Nothing written: a rebuild's update waits the quiet window, no more.
		const before = assetStamps(dir);
		const carried: string[] = [];
		let started = performance.now();
		await settle(rx, dir, before, QUIET, carried);
		assert.ok(performance.now() - started < 1200, String(performance.now() - started));

		// The build's own write of a page, and a source edit, don't count as the tool's; the
		// edit is kept for later. The tool's write does, and the window starts again from it.
		const source = path.join(path.dirname(dir), "src-index.edge");
		const writer = (async () => {
			rx.send([path.join(dir, "index.html"), source]);
			await sleep(400);
			fs.writeFileSync(css, "a{color:red}");
			rx.send([css]);
		})();
		started = performance.now();
		await settle(rx, dir, before, 2000, carried);
		const waited = performance.now() - started;
		await writer;
		assert.ok(waited >= 400 + QUIET - 5 && waited < 1500, String(waited));
		assert.deepEqual(carried, [source]);

		// A tool that wrote before the wait began (during the build) is seen at once.
		fs.writeFileSync(css, "a{color:green}");
		started = performance.now();
		await settle(rx, dir, before, 2000, []);
		assert.ok(performance.now() - started < 1200, String(performance.now() - started));
	} finally {
		remove(dir);
	}
});

/** Starts `ssqch serve` on `dir` and waits for its ready file. */
async function serve(dir: string, extra: string[] = []) {
	const ready = path.join(dir, "ready.json");
	const log = path.join(dir, "serve.log");
	const out = fs.openSync(log, "w");
	const child = spawn(process.execPath, [BIN, "serve", "--port", "0", "--ready-file", ready, "--root", dir, ...extra], { stdio: ["ignore", out, out], env: { ...process.env, NO_COLOR: "1", TZ: "UTC" } });
	const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
	const said = () => readOr(log);
	const until = async (found: () => boolean | Promise<boolean>, what: string) => {
		const started = Date.now();
		while (!(await found())) {
			assert.ok(Date.now() - started < 30_000, `${what}:\n${said()}`);
			await sleep(40);
		}
	};
	const stop = async () => {
		child.kill();
		await exited;
		fs.closeSync(out);
	};
	try {
		await until(() => readOr(ready).includes("\"ok\""), "the server never said it was ready");
	} catch (e) {
		await stop();
		throw e;
	}
	const info = JSON.parse(readOr(ready)) as { port: number; ok: boolean; output: string };
	/** Writes `text` to `rel` until `page` holds `expected`: a change that lands before the server watches again isn't seen. */
	const change = async (rel: string, text: string, page: string, expected: string) => {
		let written = 0;
		await until(() => {
			if (Date.now() - written > 1500) {
				fs.writeFileSync(path.join(dir, rel), text);
				written = Date.now();
			}
			return readOr(path.join(dir, page)).includes(expected);
		}, `${page} never had ${JSON.stringify(expected)} after writing ${rel}; it has ${JSON.stringify(readOr(path.join(dir, page)))}`);
	};
	return { info, said, until, change, stop, get: (url: string) => fetch(`http://127.0.0.1:${info.port}${url}`, { redirect: "manual" }) };
}

// Every module a site's JavaScript loaded is read again when one of them changes: ES modules,
// CommonJS ones, what they `require` (through a file that only passes another's exports on, too),
// an ES module a CommonJS one requires, JSON, and whatever state a module kept.
test("a changed module is read again, whatever kind it is and whatever loaded it", async () => {
	const dir = tempDir("serve-modules");
	write(dir, {
		"ssqch.config.js": "import { shout } from \"./lib/shout.js\";\nimport words from \"./lib/words.cjs\";\nimport sizes from \"./lib/sizes.json\";\nexport default { dirs: { input: \"src\", output: \"dist\" }, filters: { shout }, data: { word: words.word, size: sizes.size } };\n",
		"lib/shout.js": "import { mark } from \"./mark.js\";\nlet calls = 0;\nexport const shout = (s) => `${s.toUpperCase()}${mark}${++calls}`;\n",
		"lib/mark.js": "export const mark = \"!\";\n",
		// A file that only hands on another's exports, which Node reads ahead when it's imported.
		"lib/words.cjs": "module.exports = require(\"./inner.cjs\");\n",
		"lib/inner.cjs": "exports.word = \"pine\";\n",
		"lib/sizes.json": "{ \"size\": 1 }\n",
		"src/_data/trail.cjs": "const { length } = require(\"../../lib/length.mjs\");\nconst { name } = require(\"../../lib/name.cjs\");\nmodule.exports = { name, length };\n",
		"lib/length.mjs": "export const length = 3;\n",
		"lib/name.cjs": "exports.name = \"Cedar\";\n",
		"src/index.jinja": "{{ shout(word) }} {{ size }} {{ trail.name }} {{ trail.length }}",
	});
	const server = await serve(dir);
	try {
		const page = "dist/index.html";
		await server.until(() => readOr(path.join(dir, page)) === "PINE!1 1 Cedar 3", "the first build");
		await server.change("lib/mark.js", "export const mark = \"?\";\n", page, "PINE?1 1 Cedar 3");
		await server.change("lib/inner.cjs", "exports.word = \"cone\";\n", page, "CONE?1 1 Cedar 3");
		await server.change("lib/sizes.json", "{ \"size\": 2 }\n", page, "CONE?1 2 Cedar 3");
		await server.change("lib/length.mjs", "export const length = 5;\n", page, "CONE?1 2 Cedar 5");
		await server.change("lib/name.cjs", "exports.name = \"Old Growth\";\n", page, "CONE?1 2 Old Growth 5");
		// A template's change builds with the modules as they are: what they've counted is kept.
		await server.change("src/index.jinja", "{{ shout(word) }} again", page, "CONE?2 again");
	} finally {
		await server.stop();
	}
	remove(dir);
});

// What a plugin says it reads (`watch`: a folder, or one file) rebuilds when it changes, wherever
// it is, and the stylesheet that comes of it is swapped in the browser. This is the server's part
// of `sassPlugin()` and its partials.
test("a file a plugin watches rebuilds the site", async () => {
	const dir = tempDir("serve-watch");
	write(dir, {
		"ssqch.config.js": "import fs from \"node:fs\";\nconst pineSass = { name: \"pine-sass\", watch: [\"styles\", \"notes.txt\"], beforeBuild: () => { fs.mkdirSync(\"dist\", { recursive: true }); fs.writeFileSync(\"dist/app.css\", `body { color: ${fs.readFileSync(\"styles/_colors.scss\", \"utf8\").trim()}; } /* ${fs.readFileSync(\"notes.txt\", \"utf8\").trim()} */`); } };\nexport default { dirs: { input: \"src\", output: \"dist\" }, plugins: [pineSass] };\n",
		"styles/_colors.scss": "green\n",
		"notes.txt": "one\n",
		"other.txt": "not watched\n",
		"src/index.html": "<link rel=\"stylesheet\" href=\"/app.css\"><p>camp</p>",
	});
	const server = await serve(dir);
	try {
		// The ready file is what the contract says it is.
		const shapes = JSON.parse(fs.readFileSync(new URL("../../../../tests/oracle/contract/shapes.json", import.meta.url), "utf8"))["serve ready file"] as Record<string, string>;
		assert.deepEqual(Object.fromEntries(Object.entries(server.info).map(([key, value]) => [key, typeof value])), shapes);
		assert.equal(fs.readFileSync(path.join(dir, "ready.json"), "utf8"), JSON.stringify(server.info, null, 2) + "\n");

		const since = (await (await server.get("/__ssqch/build?v=&p=%2F")).json() as { id: number }).id;
		await server.change("styles/_colors.scss", "orange\n", "dist/app.css", "orange; } /* one */");
		await server.change("notes.txt", "two\n", "dist/app.css", "orange; } /* two */");
		let answer: { reload: boolean; css: string[] } | undefined;
		await server.until(async () => {
			answer = await (await server.get(`/__ssqch/build?v=${since}&p=%2F`)).json() as { reload: boolean; css: string[] };
			return answer.css.length > 0;
		}, "the browser never heard of the stylesheet");
		assert.deepEqual(answer, { ...answer, reload: false, css: ["/app.css"] });
		// A file beside a watched one isn't the site's. The stylesheet is written before its
		// build's summary: the count starts once the last build has said it's serving again.
		const builds = () => server.said().split("Built in").length - 1;
		await server.until(() => server.said().split("Fresh tracks in").at(-1)!.includes("Squatch Watch is on."), "the last build never finished");
		const before = builds();
		fs.writeFileSync(path.join(dir, "other.txt"), "still not watched\n");
		await sleep(1500);
		assert.equal(builds(), before, server.said());
	} finally {
		await server.stop();
	}
	remove(dir);
});

// A watched file outside the site's root is named from the root, as one inside is: the website
// watches the docs pages beside it, and said `Fresh tracks in /Users/.../docs/guide.md`.
test("a watched file outside the root is named from the root", async () => {
	const dir = tempDir("serve-outside");
	write(dir, {
		"site/ssqch.config.js": "import fs from \"node:fs\";\nconst notes = { name: \"notes\", watch: [\"../notes.txt\"], beforeBuild: () => { fs.mkdirSync(\"dist\", { recursive: true }); fs.writeFileSync(\"dist/notes.txt\", fs.readFileSync(\"../notes.txt\", \"utf8\")); } };\nexport default { dirs: { input: \"src\", output: \"dist\" }, plugins: [notes] };\n",
		"site/src/index.html": "<p>camp</p>",
		"notes.txt": "pine cones\n",
	});
	const server = await serve(path.join(dir, "site"));
	try {
		await server.change("../notes.txt", "squatch snacks\n", "dist/notes.txt", "squatch snacks");
		await server.until(() => server.said().includes("Fresh tracks in"), "no Fresh tracks line");
		assert.ok(server.said().includes(`Fresh tracks in ${path.join("..", "notes.txt")}\n`), server.said());
	} finally {
		await server.stop();
	}
	remove(dir);
});

// What a plugin read for the last build is watched too, wherever it is: a stylesheet's partial
// in a folder the config never named.
test("a file a plugin read rebuilds the site", async () => {
	const dir = tempDir("serve-read");
	write(dir, {
		"ssqch.config.js": "import { sassPlugin } from \"ssqch/sass\";\nexport default { dirs: { input: \"src\", output: \"dist\" }, plugins: [sassPlugin({ files: { \"styles/main.scss\": \"/app.css\" } })] };\n",
		"styles/main.scss": "@use \"../shared/colors\";\nbody { color: colors.$pine; }\n",
		"shared/_colors.scss": "$pine: green;\n",
		"shared/notes.txt": "not a stylesheet's\n",
		"src/index.html": "<link rel=\"stylesheet\" href=\"/app.css\"><p>camp</p>",
	});
	const server = await serve(dir);
	try {
		assert.ok(readOr(path.join(dir, "dist/app.css")).includes("green"), server.said());
		await server.change("shared/_colors.scss", "$pine: orange;\n", "dist/app.css", "orange");
		assert.ok(server.said().includes(`Fresh tracks in ${path.join("shared", "_colors.scss")}\n`), server.said());
		// A file beside it that nothing read isn't the site's. Counted from the end of the rebuild,
		// whose summary comes a few milliseconds after its stylesheet.
		const builds = () => server.said().split("Built in").length - 1;
		for (const started = Date.now(); builds() < 2 && Date.now() - started < 10_000;) await sleep(20);
		const before = builds();
		fs.writeFileSync(path.join(dir, "shared/notes.txt"), "still not\n");
		await sleep(1500);
		assert.equal(builds(), before, server.said());
	} finally {
		await server.stop();
	}
	remove(dir);
});

// A configuration that waits for something that never comes is an error like any other of its
// errors (in `ssqch build` too), and the last one that loaded keeps serving.
test("a configuration that never finishes loading is an error", async () => {
	const dir = tempDir("serve-config-never");
	const config = (word: string, extra = "") => `${extra}export default { dirs: { input: "src", output: "dist" }, data: { word: "${word}" } };\n`;
	write(dir, { "ssqch.config.js": config("one"), "src/index.jinja": "{{ word }}" });
	const server = await serve(dir);
	try {
		await server.change("ssqch.config.js", config("two", "await new Promise(() => {});\n"), "serve.log", "a Promise never settled");
		await server.until(() => server.said().includes("(still serving with the last configuration that loaded)"), "the last configuration wasn't kept");
		assert.ok(/Config error: ssqch\.config\.js: a Promise never settled/.test(server.said()), server.said());
		await server.change("src/index.jinja", "{{ word }} still", "dist/index.html", "one still");
		await server.change("ssqch.config.js", config("three"), "dist/index.html", "three still");
	} finally {
		await server.stop();
	}
	remove(dir);
});

// A rebuild leaves a page alone when it comes out the same, and knows that without reading the
// file again when the file hasn't been written since. A page something else wrote over is
// still found out, and written again.
test("a page something else wrote over is written again", async () => {
	const dir = tempDir("serve-overwritten");
	write(dir, {
		"ssqch.config.js": "export default { dirs: { input: \"src\", output: \"dist\" } };\n",
		"src/index.md": "Home\n",
		"src/about.md": "About\n",
	});
	const server = await serve(dir);
	try {
		const home = path.join(dir, "dist/index.html");
		assert.equal(readOr(home), "<p>Home</p>\n");
		// Long enough for the next build to trust what it finds on the disk.
		await sleep(2700);
		await server.change("src/about.md", "About us\n", "dist/about/index.html", "About us");
		await server.change("src/about.md", "About them\n", "dist/about/index.html", "About them");
		await server.until(() => server.said().split("(1 changed)").length - 1 >= 2, "two rebuilds of one page");
		// The same size, other words.
		fs.writeFileSync(home, "<p>Hoax</p>\n");
		await server.change("src/about.md", "About it\n", "dist/about/index.html", "About it");
		await server.until(() => readOr(home) === "<p>Home</p>\n", "the page was left as something else wrote it");
		assert.ok(server.said().includes("(2 changed)"), server.said());
	} finally {
		await server.stop();
	}
	remove(dir);
});

// The server answers while a build runs: a page from the last build, and the browser's question.
test("the server answers during a build, and survives a site that ends its process", async () => {
	const dir = tempDir("serve-busy");
	write(dir, {
		"ssqch.config.js": "import fs from \"node:fs\";\nexport default { dirs: { input: \"src\", output: \"dist\" }, data: { slow: async () => { const how = fs.readFileSync(\"how.txt\", \"utf8\").trim(); if (how === \"slow\") await new Promise((r) => setTimeout(r, 1500)); if (how === \"exit\") process.exit(7); if (how === \"never\") await new Promise(() => {}); return how; } } };\n",
		"how.txt": "quick\n",
		"src/index.jinja": "{{ slow }} {{ n }}",
		"src/index.json": "{ \"n\": 1 }",
	});
	const server = await serve(dir);
	try {
		const page = path.join(dir, "dist/index.html");
		assert.equal(readOr(page), "quick 1");
		fs.writeFileSync(path.join(dir, "how.txt"), "slow\n");
		await server.change("src/index.json", "{ \"n\": 2 }", "serve.log", "Fresh tracks in");
		// The build is waiting on the site's data: the server isn't.
		const started = performance.now();
		const response = await server.get("/");
		assert.ok((await response.text()).includes("quick 1") && performance.now() - started < 1000);
		await server.until(() => readOr(page) === "slow 2", "the slow build");

		// A promise nothing can settle fails the build, as it does in `ssqch build`.
		fs.writeFileSync(path.join(dir, "how.txt"), "never\n");
		await server.change("src/index.json", "{ \"n\": 3 }", "serve.log", "a Promise never settled");
		const broken = await (await server.get("/__ssqch/build?v=&p=%2F")).json() as { error: string | null };
		assert.ok(broken.error?.includes("a Promise never settled"), JSON.stringify(broken));

		// The site's code ends the process: that build failed, and the next one has a new process.
		fs.writeFileSync(path.join(dir, "how.txt"), "exit\n");
		await server.change("src/index.json", "{ \"n\": 4 }", "serve.log", "The build's process ended before the build did (exit code 7)");
		fs.writeFileSync(path.join(dir, "how.txt"), "back\n");
		await server.change("src/index.json", "{ \"n\": 5 }", "dist/index.html", "back 5");
		// The page is written while the build runs; its summary comes after.
		await server.until(() => server.said().includes("Build recovered. Back on the trail."), "the recovered build's summary");
	} finally {
		await server.stop();
	}
	remove(dir);
});

test("an editor's own files aren't the site's", () => {
	for (const file of [".!64277!i-know-what-i-saw.md", "hello.md~", ".#hello.md", ".hello.md.swp", ".hello.md.swo", "4913", "hello.md___jb_tmp___", "hello.md___jb_old___"]) assert.ok(editorsOwn(path.join("src", "posts", file)), file);
	for (const file of ["hello.md", ".eleventy.js", ".well-known", "swp.md", "!important.md", "49130", ".swp"]) assert.ok(!editorsOwn(path.join("src", file)), file);
});
