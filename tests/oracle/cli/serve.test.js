// From crates/ssqch/tests/cli.rs.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { ssqch, tempDir, write } from "../lib/ssqch.js";
import { start, sleep, waitFor, changeAndWait, httpGet, body, serveSite } from "../lib/serve.js";

const unixOnly = { skip: process.platform === "win32" && "unix only" };
const readOr = (file) => { try { return fs.readFileSync(file, "utf8"); } catch { return ""; } };
const count = (text, part) => text.split(part).length - 1;
const alive = (pid) => { try { process.kill(Number(pid), 0); return true; } catch { return false; } };

// `serve.run` starts a watcher with the server, shows its output under its
// name, and stops it (and what it started) when the server stops.
test("serve_runs_companion_processes", unixOnly, async () => {
	const dir = tempDir("serve-companions");
	// A stand-in for a CSS watcher: it writes the stylesheet, says so, records its pid and keeps
	// watching until its standard input closes, as Tailwind's and esbuild's `--watch` do.
	const script = "#!/bin/sh\necho $$ > \"$SSQCH_INPUT/../watcher.pid\"\nmkdir -p \"$SSQCH_OUTPUT/assets\"\necho 'body { color: pine; }' > \"$SSQCH_OUTPUT/assets/app.css\"\necho \"wrote app.css, serving=$SSQCH_SERVING quiet=$SSQCH_QUIET\"\ncat > /dev/null\nwhile true; do sleep 0.2; done\n";
	write(dir, { "bin/pinecss": script });
	fs.chmodSync(path.join(dir, "bin/pinecss"), 0o755);
	write(dir, {
		"ssqch.config.js": "export default { dirs: { input: \"src\" }, serve: { run: [\"./bin/pinecss --watch\"] } };\n",
		"src/index.html": "<link rel=\"stylesheet\" href=\"/assets/app.css\"><p>camp</p>",
	});
	const log = path.join(tempDir("serve-companions-log"), "serve.log");
	const server = start(["serve", "--port", "0", "--root", dir], { logFile: log });
	try {
		await waitFor(log, "[pinecss] wrote app.css, serving=true quiet=false");
		await waitFor(path.join(dir, "_site/assets/app.css"), "color: pine");
		await waitFor(path.join(dir, "watcher.pid"), "\n");
		const pid = fs.readFileSync(path.join(dir, "watcher.pid"), "utf8").trim();
		// Still watching a moment later: its standard input is held open.
		await sleep(500);
		assert.ok(alive(pid) && !readOr(log).includes("warn:"), readOr(log));
		// A build doesn't run them.
		assert.ok(readOr(log).includes("[ssqch] serve.run: ./bin/pinecss --watch\n"));
		// Stopping the server stops the watcher.
		process.kill(server.pid, "SIGTERM");
		const started = Date.now();
		while (alive(pid)) {
			assert.ok(Date.now() - started < 10_000, `the watcher outlived the server:\n${readOr(log)}`);
			await sleep(50);
		}
		assert.ok(!readOr(log).includes("warn:"), readOr(log));
	} finally {
		await server.stop();
	}
	// With --quiet, SSQCH_QUIET says so, as it does for build hooks.
	const quietLog = path.join(tempDir("serve-companions-quiet-log"), "serve.log");
	const quiet = start(["serve", "--port", "0", "--root", dir, "--quiet"], { logFile: quietLog });
	try {
		await waitFor(quietLog, "[pinecss] wrote app.css, serving=true quiet=true");
	} finally {
		await quiet.stop();
	}
	// Not an option it knows: an error that says so. DELIBERATE (0.13.6): it lists `ignore` too.
	write(dir, { "ssqch.config.js": "export default { serve: { runs: [\"x\"] } };\n" });
	const r = ssqch(["build", "--root", dir]);
	assert.ok(!r.ok && r.log.includes("serve: \"runs\" isn't an option (options: run, ignore)"), r.log);
});

// Another build into the output folder (a production build, which cleans it and renames the
// stylesheet to a fingerprinted name) deletes what a `serve.run` watcher wrote. The watcher
// would only write it again when its source changes, so the server starts it again and
// rebuilds, and the page links the plain file again.
test("serve_recovers_when_another_build_deletes_a_watchers_file", unixOnly, async () => {
	const dir = tempDir("serve-companions-trampled");
	const script = "#!/bin/sh\necho start >> \"$SSQCH_INPUT/../starts\"\nmkdir -p \"$SSQCH_OUTPUT/assets\"\necho 'body { color: pine; }' > \"$SSQCH_OUTPUT/assets/app.css\"\ncat > /dev/null\nwhile true; do sleep 0.2; done\n";
	write(dir, { "bin/pinecss": script });
	fs.chmodSync(path.join(dir, "bin/pinecss"), 0o755);
	write(dir, {
		"ssqch.config.js": "import { assetsPlugin } from \"ssqch/assets\";\nexport default { dirs: { input: \"src\" }, serve: { run: [\"./bin/pinecss --watch\"] }, plugins: [assetsPlugin({ files: [\"/assets/app.css\"] })] };\n",
		"src/index.html": "<link rel=\"stylesheet\" href=\"/assets/app.css\"><p>camp</p>",
	});
	const log = path.join(tempDir("serve-companions-trampled-log"), "serve.log");
	const server = start(["serve", "--port", "0", "--root", dir], { logFile: log });
	try {
		await waitFor(path.join(dir, "_site/assets/app.css"), "color: pine");
		await waitFor(log, "Squatch Watch is on.");
		// Past the server's one-second wait for more changes, so it has seen the file before it goes.
		await sleep(1500);
		// What a production build leaves: the plain file renamed, and a page linking the copy.
		fs.renameSync(path.join(dir, "_site/assets/app.css"), path.join(dir, "_site/assets/app.0123abcd.css"));
		fs.writeFileSync(path.join(dir, "_site/index.html"), "<link rel=\"stylesheet\" href=\"/assets/app.0123abcd.css\"><p>camp</p>");
		await waitFor(log, "Campsite disturbed: _site/assets/app.css deleted by something other than ssqch serve (another build into _site?). Starting serve.run's pinecss again and rebuilding.");
		await waitFor(path.join(dir, "starts"), "start\nstart\n");
		await waitFor(path.join(dir, "_site/assets/app.css"), "color: pine");
		await waitFor(path.join(dir, "_site/index.html"), "href=\"/assets/app.css\"");
	} finally {
		await server.stop();
	}
});

// A companion that stopped starts again when the config is saved, and all of them start again
// when the folders they were given change.
test("serve_restarts_companions_on_reload", unixOnly, async () => {
	const dir = tempDir("serve-companions-reload");
	write(dir, { "src/index.html": "<p>camp</p>" });
	const config = (extra) => `export default { dirs: { input: "src"${extra} }, serve: { run: ["echo out=$SSQCH_OUTPUT"] } };\n`;
	write(dir, { "ssqch.config.js": config("") });
	const log = path.join(tempDir("serve-companions-reload-log"), "serve.log");
	const server = start(["serve", "--port", "0", "--root", dir], { logFile: log });
	try {
		const read = () => readOr(log);
		const waitCount = async (text, n) => {
			const started = Date.now();
			while (count(read(), text) < n) {
				assert.ok(Date.now() - started < 15_000, `waiting for ${n} of ${JSON.stringify(text)}:\n${read()}`);
				await sleep(50);
			}
		};
		await waitCount("warn: serve.run: `echo out=$SSQCH_OUTPUT` finished. The server keeps going without it; save the config file to start it again.", 1);
		assert.ok(read().includes("[echo] out=") && read().includes("_site\n"), read());
		// Saved again until the server notices: a save that lands while it's still reloading from
		// the last one, before it watches the files again, isn't seen (on Linux, now and then).
		const saveUntil = async (text, n) => {
			const started = Date.now();
			while (count(read(), "[ssqch] serve.run: echo out=$SSQCH_OUTPUT") < n) {
				fs.writeFileSync(path.join(dir, "ssqch.config.js"), config(text));
				const written = Date.now();
				while (count(read(), "[ssqch] serve.run: echo out=$SSQCH_OUTPUT") < n && Date.now() - written < 2000) {
					await sleep(50);
				}
				assert.ok(Date.now() - started < 20_000, `waiting for start ${n}:\n${read()}`);
			}
		};
		// Saved as it was: the one that finished starts again.
		await saveUntil("", 2);
		// Another output folder: started again, with it.
		await saveUntil(", output: \"dist\"", 3);
		await waitCount("dist\n", 1);
	} finally {
		await server.stop();
	}
});

// A stylesheet a page links that nothing wrote: the page asks the server, which says so once,
// names what could have written it, and says it again after each build until it's there.
test("serve_says_when_a_linked_file_is_missing", async () => {
	const dir = tempDir("serve-missing");
	write(dir, {
		"ssqch.config.js": "export default { dirs: { input: \"src\" } };\n",
		"src/index.html": "<link rel=\"stylesheet\" href=\"/assets/app.css\"><p>camp</p>",
	});
	const log = path.join(tempDir("serve-missing-log"), "serve.log");
	const ready = path.join(tempDir("serve-missing-ready"), "ready.json");
	const server = start(["serve", "--port", "0", "--root", dir, "--ready-file", ready], { logFile: log });
	try {
		await waitFor(ready, "\"ok\": true");
		const info = JSON.parse(fs.readFileSync(ready, "utf8"));
		const port = info.port;
		const ask = async (p) => {
			const response = await httpGet(port, `/__ssqch/missing?path=${p}`);
			try { return JSON.parse(body(response)); } catch (e) { throw new Error(`${e.message}: ${response}`); }
		};
		// DELIBERATE (0.10): the docs are pages of their own now; the message names the command that prints the section.
		const said = "/assets/app.css is linked but nothing wrote it to _site. If a tool makes it, run its watcher with `serve.run` (`ssqch docs \"CSS and JavaScript\"`)";
		assert.equal((await ask("%2Fassets%2Fapp.css")).message, said);
		await ask("%2Fassets%2Fapp.css");
		// Said once, however many pages ask.
		await waitFor(log, said);
		assert.equal(count(readOr(log), said), 1);
		// Said again after the next build, while it's still missing.
		await changeAndWait(path.join(dir, "src/index.html"), "<link rel=\"stylesheet\" href=\"/assets/app.css\"><p>camp two</p>", path.join(dir, "_site/index.html"), "camp two");
		const started = Date.now();
		while (count(readOr(log), said) < 2) {
			assert.ok(Date.now() - started < 10_000, readOr(log));
			await sleep(50);
		}
		// There now: nothing to say.
		write(dir, { "_site/assets/app.css": "body {}" });
		assert.equal((await ask("%2Fassets%2Fapp.css")).message ?? null, null);
		assert.equal((await ask("%2F..%2Fetc%2Fpasswd")).message ?? null, null);
	} finally {
		await server.stop();
	}
});

// Blog #14: Tailwind's first compile took longer than the first build's 2 s wait, and the page's
// stylesheet was warned about as missing a moment before it turned up. DELIBERATE (0.13.6): while a
// `serve.run` tool is still running and hasn't written it, the page hears that, and the terminal
// says nothing; once it's written, nothing is said at all.
test("serve_waits_for_a_slow_first_compile_before_warning", unixOnly, async () => {
	const dir = tempDir("serve-slow-compile");
	// A stand-in for a slow Tailwind: it writes the stylesheet only once the test says so.
	const script = "#!/bin/sh\ncat > /dev/null &\nwhile [ ! -f \"$SSQCH_INPUT/../go\" ]; do sleep 0.1; done\nmkdir -p \"$SSQCH_OUTPUT/assets\"\necho 'body { color: pine; }' > \"$SSQCH_OUTPUT/assets/app.css\"\necho wrote app.css\nwhile true; do sleep 0.2; done\n";
	write(dir, { "bin/slowcss": script });
	fs.chmodSync(path.join(dir, "bin/slowcss"), 0o755);
	write(dir, {
		"ssqch.config.js": "export default { dirs: { input: \"src\" }, serve: { run: [\"./bin/slowcss --watch\"] } };\n",
		"src/index.html": "<link rel=\"stylesheet\" href=\"/assets/app.css\"><p>camp</p>",
	});
	const log = path.join(tempDir("serve-slow-compile-log"), "serve.log");
	const ready = path.join(tempDir("serve-slow-compile-ready"), "ready.json");
	const server = start(["serve", "--port", "0", "--root", dir, "--ready-file", ready], { logFile: log });
	try {
		await waitFor(ready, "\"ok\": true");
		const { port } = JSON.parse(fs.readFileSync(ready, "utf8"));
		const ask = async () => {
			const response = await httpGet(port, "/__ssqch/missing?path=%2Fassets%2Fapp.css");
			try { return JSON.parse(body(response)).message ?? null; } catch (e) { throw new Error(`${e.message}: ${response}`); }
		};
		assert.ok(readOr(log).includes("[ssqch] serve.run's tools wrote no CSS or JavaScript in 2 s; building now, and what they write goes in when it's ready"), readOr(log));
		assert.equal(await ask(), "/assets/app.css isn't in _site yet: serve.run's slowcss is still running and hasn't written it. The page gets it when it's written");
		assert.ok(!readOr(log).includes("warn:"), readOr(log));
		fs.writeFileSync(path.join(dir, "go"), "");
		await waitFor(path.join(dir, "_site/assets/app.css"), "color: pine");
		assert.equal(await ask(), null);
		await waitFor(log, "Fresh tracks in ");
		assert.ok(!readOr(log).includes("warn:"), readOr(log));
	} finally {
		await server.stop();
	}
});

test("serve_reads_a_changed_config_again", async () => {
	const dir = tempDir("serve-reload");
	write(dir, {
		"ssqch.config.js": "import { shout } from \"./lib/filters.js\";\nimport { rssPlugin } from \"ssqch/rss\";\nexport default { dirs: { input: \"src\", output: \"dist\" }, filters: { shout }, data: { greeting: \"hello\" }, plugins: [rssPlugin()] };\n",
		"lib/filters.js": "export const shout = (s) => s.toUpperCase() + \"!\";\n",
		"src/_data/info.js": "import { n } from \"../util/helper.js\";\nexport default { n };\n",
		"src/util/helper.js": "export const n = 1;\n",
		"src/index.jinja": "{{ shout(greeting) }} {{ info.n }}",
	});
	const log = path.join(dir, "serve.log");
	const server = start(["serve", "--port", "0", "--root", dir], { logFile: log });
	try {
		const page = path.join(dir, "dist/index.html");
		await waitFor(page, "HELLO! 1");

		// A module the config imports, outside the input folder.
		await changeAndWait(path.join(dir, "lib/filters.js"), "export const shout = (s) => s.toUpperCase() + \"?\";\n", page, "HELLO? 1");
		// A module a data file imports.
		await changeAndWait(path.join(dir, "src/util/helper.js"), "export const n = 2;\n", page, "HELLO? 2");
		// A config that doesn't load is reported, and the last good one keeps serving.
		await changeAndWait(path.join(dir, "ssqch.config.js"), "export default { dirs: { ouput: \"dist\" } };\n", log, "dirs.ouput isn't supported");
		await waitFor(log, "still serving with the last configuration that loaded");
		// The last good one's image processor is still there for feedHtml().
		await changeAndWait(path.join(dir, "src/index.jinja"), "{{ shout(greeting) }} {{ info.n }} {{ feedHtml(\"<p>trail</p>\", \"https://example.com/\") }}", page, "HELLO? 2 &lt;p&gt;trail");
		// Fixed, with a changed setting.
		await changeAndWait(path.join(dir, "ssqch.config.js"), "import { shout } from \"./lib/filters.js\";\nimport { rssPlugin } from \"ssqch/rss\";\nexport default { dirs: { input: \"src\", output: \"dist\" }, filters: { shout }, data: { greeting: \"howdy\" }, plugins: [rssPlugin()] };\n", page, "HOWDY? 2");
		// Templates still rebuild as before.
		await changeAndWait(path.join(dir, "src/index.jinja"), "plain {{ info.n }}", page, "plain 2");
	} finally {
		await server.stop();
	}
});

// A file the site's code reads with readData() or files(), outside the input
// folder, is watched like a module the config imports: an edit to it showed
// nothing until the server started again (0.15.1). Read while the config
// loads, and read in a data function on each build.
// The debounce is 50 ms of quiet (it was 120). Vim's save renames the file away for its backup
// and writes it again 40 to 50 ms later: a rebuild in between would drop the page and put it back
// a moment later. A file that's gone when the quiet ends waits up to 200 ms more for its return.
test("serve_waits_for_a_save_that_renames_the_file_away_first", async () => {
	const dir = tempDir("serve-vim-save");
	write(dir, { "ssqch.config.js": "export default { dirs: { input: \"src\", output: \"dist\" } };\n", "src/post.md": "Cedar Trail\n" });
	const log = path.join(tempDir("serve-vim-save-log"), "serve.log");
	const server = start(["serve", "--port", "0", "--root", dir], { logFile: log });
	try {
		const page = path.join(dir, "dist/post/index.html");
		await waitFor(page, "Cedar Trail");
		await waitFor(log, "Serving ");
		await sleep(300);
		const before = readOr(log).split("Built in").length;
		const source = path.join(dir, "src/post.md");
		fs.renameSync(source, `${source}~`);
		await sleep(45);
		fs.writeFileSync(source, "Old Growth Trail\n");
		fs.rmSync(`${source}~`);
		await waitFor(page, "Old Growth Trail");
		await sleep(800);
		const said = readOr(log);
		assert.equal(said.split("Built in").length - before, 1, said);
		assert.ok(fs.existsSync(page));
	} finally {
		await server.stop();
	}
});

// Where the system sends no file events (a Windows drive under WSL, some Docker mounts), the
// server built once and never again, without a word. SSQCH_WATCH=poll looks at the files now and
// then instead, and says so once.
test("serve_polls_for_changes_when_asked", async () => {
	const dir = tempDir("serve-poll");
	write(dir, {
		"ssqch.config.js": "export default { dirs: { input: \"src\", output: \"dist\" } };\n",
		"src/index.md": "Cedar Trail\n",
	});
	const log = path.join(tempDir("serve-poll-log"), "serve.log");
	const server = start(["serve", "--port", "0", "--root", dir], { logFile: log, env: { SSQCH_WATCH: "poll" } });
	try {
		const page = path.join(dir, "dist/index.html");
		await waitFor(page, "Cedar Trail");
		await changeAndWait(path.join(dir, "src/index.md"), "Old Growth Trail\n", page, "Old Growth Trail");
		// A page added in a new folder.
		write(dir, { "src/trails/cedar.md": "Four miles\n" });
		await waitFor(path.join(dir, "dist/trails/cedar/index.html"), "Four miles");
		const said = readOr(log);
		assert.equal(said.split("Watching by looking at every file now and then (SSQCH_WATCH=poll)").length, 2, said);
	} finally {
		await server.stop();
	}
});

test("serve_rebuilds_for_a_data_file_its_code_read", async () => {
	const dir = tempDir("serve-read-data");
	write(dir, {
		"ssqch.config.js": "import { files, readData } from \"ssqch\";\nconst site = readData(\"data/site.yml\");\nexport default { dirs: { input: \"src\", output: \"dist\" }, data: { site, snack: () => readData(\"data/snack.yml\"), photos: () => files(\"photos/*.txt\").map((f) => f.size) } };\n",
		"data/site.yml": "title: Squatch Snacks\n",
		"data/snack.yml": "name: Pine Cone Crunch\n",
		"photos/a.txt": "ab",
		"src/index.jinja": "{{ site.title }}: {{ snack.name }} {{ photos | join(\",\") }}",
	});
	const log = path.join(dir, "serve.log");
	const server = start(["serve", "--port", "0", "--root", dir], { logFile: log });
	try {
		const page = path.join(dir, "dist/index.html");
		await waitFor(page, "Squatch Snacks: Pine Cone Crunch 2");
		// Read in a data function, on each build.
		await changeAndWait(path.join(dir, "data/snack.yml"), "name: Moss Mix\n", page, "Squatch Snacks: Moss Mix 2");
		// Read while the config loaded: in the config's values.
		await changeAndWait(path.join(dir, "data/site.yml"), "title: Squatch Provisions\n", page, "Squatch Provisions: Moss Mix 2");
		// A file files() matched.
		await changeAndWait(path.join(dir, "photos/a.txt"), "abcd", page, "Squatch Provisions: Moss Mix 4");
		// The server names a file with the platform's separator (`data\snack.yml` on Windows).
		assert.ok(readOr(log).includes(`Fresh tracks in ${path.join("data", "snack.yml")} (reading the configuration again)`), readOr(log));
	} finally {
		await server.stop();
	}
	// In a folder `watch` names, a value read while the config loaded is still the config's: a
	// rebuild alone kept the old one (the 2026-11-24 review).
	const watched = tempDir("serve-read-watched");
	write(watched, {
		"ssqch.config.js": "import { readData } from \"ssqch\";\nconst snack = readData(\"data/snack.json\");\nexport default { dirs: { input: \"src\", output: \"dist\" }, watch: [\"data\"], data: { snack } };\n",
		"data/snack.json": "{\"name\":\"Pine\"}",
		"src/index.jinja": "{{ snack.name }}",
	});
	const again = start(["serve", "--port", "0", "--root", watched], { logFile: path.join(watched, "serve.log") });
	try {
		const page = path.join(watched, "dist/index.html");
		await waitFor(page, "Pine");
		await changeAndWait(path.join(watched, "data/snack.json"), "{\"name\":\"Moss\"}", page, "Moss");
	} finally {
		await again.stop();
	}
});

// A `beforeBuild` hook that writes a file the config reads with readData()
// (stock, fetched on each build) changes it on every build: that's what the
// build used, not an edit, so an edit to a page is one build, not a reload.
test("serve_does_not_reload_for_a_data_file_its_own_build_wrote", async () => {
	const dir = tempDir("serve-hook-data");
	write(dir, {
		"ssqch.config.js": "import fs from \"node:fs\";\nimport { readData } from \"ssqch\";\nlet n = 0;\nexport default { dirs: { input: \"src\", output: \"dist\" }, beforeBuild: [() => fs.writeFileSync(\"data/stock.json\", JSON.stringify({ n: ++n }))], data: { stock: () => readData(\"data/stock.json\") } };\n",
		"data/stock.json": "{\"n\":0}",
		"src/index.jinja": "one {{ stock.n }}",
	});
	const log = path.join(dir, "serve.log");
	const server = start(["serve", "--port", "0", "--root", dir], { logFile: log });
	try {
		const page = path.join(dir, "dist/index.html");
		await waitFor(page, "one 1");
		await changeAndWait(path.join(dir, "src/index.jinja"), "two {{ stock.n }}", page, "two 2");
		await changeAndWait(path.join(dir, "src/index.jinja"), "three {{ stock.n }}", page, "three 3");
		// The same process counted every build: a reload would have started n again.
		await sleep(2500);
		assert.ok(fs.readFileSync(page, "utf8").includes("three 3"), fs.readFileSync(page, "utf8"));
		assert.equal(count(readOr(log), "reading the configuration again"), 0, readOr(log));
	} finally {
		await server.stop();
	}
});

// A site whose input folder is the project root (the default) has ssqch's
// own `.cache` and the output inside what's watched. Writing them isn't a change.
test("serve_does_not_rebuild_for_its_own_files", async () => {
	const dir = tempDir("serve-root");
	write(dir, {
		"index.jinja": "one {{ 1 + 1 }}",
		// DELIBERATE (0.13): `leaveNoTrace`, which `clean` was another name for.
		"ssqch.config.js": "export default { leaveNoTrace: true };\n",
	});
	// The server's output goes outside the folder it watches: a log in there changes with every build.
	const log = path.join(tempDir("serve-root-log"), "serve.log");
	const server = start(["serve", "--port", "0", "--root", dir], { logFile: log });
	try {
		const page = path.join(dir, "_site/index.html");
		await waitFor(page, "one 2");
		const builds = () => count(readOr(log), "Built in");
		await sleep(1500);
		assert.equal(builds(), 1, `it rebuilt with nothing changed:\n${readOr(log)}`);
		await changeAndWait(path.join(dir, "index.jinja"), "two {{ 2 + 2 }}", page, "two 4");
		await sleep(1500);
		let said = readOr(log);
		assert.equal(builds(), 2, said);
		// The server says its name, and what changed.
		assert.ok(said.includes("Serving ") && said.includes("/. Squatch Watch is on.\n") && said.includes("Fresh tracks in index.jinja\n"), said);
		// The first build is the site's first; the rebuild isn't.
		assert.equal(count(said, "First confirmed sighting. Built in"), 1, said);
		// A build that works after one that failed says so, once.
		fs.writeFileSync(path.join(dir, "index.jinja"), "three {{ 2 + }}");
		const start0 = Date.now();
		while (!readOr(log).includes("Build failed") && Date.now() - start0 < 20_000) {
			await sleep(100);
		}
		await changeAndWait(path.join(dir, "index.jinja"), "three {{ 2 + 1 }}", page, "three 3");
		await changeAndWait(path.join(dir, "index.jinja"), "four {{ 2 + 2 }}", page, "four 4");
		await sleep(500);
		said = readOr(log);
		assert.ok(said.includes("Build failed"), said);
		assert.equal(count(said, "Build recovered. Back on the trail. Built in"), 1, said);
	} finally {
		await server.stop();
	}
});

// a11y #20 and the new-blog run: macOS `sed -i` writes `.!64277!hello.md` beside the post, and the
// server said `Fresh tracks in .!64277!hello.md` and rebuilt for nothing. DELIBERATE (0.13.5): an
// editor's own files (sed's, backups, Emacs' locks, Vim's swap files) start no build.
test("serve_ignores_an_editors_own_files", async () => {
	const dir = tempDir("serve-editor-files");
	write(dir, { "index.jinja": "one", "ssqch.config.js": "export default {};\n" });
	const log = path.join(tempDir("serve-editor-files-log"), "serve.log");
	const server = start(["serve", "--port", "0", "--root", dir], { logFile: log });
	try {
		const page = path.join(dir, "_site/index.html");
		await waitFor(page, "one");
		for (const name of [".!64277!index.jinja", "index.jinja~", ".#index.jinja", ".index.jinja.swp"]) fs.writeFileSync(path.join(dir, name), "two");
		fs.rmSync(path.join(dir, ".!64277!index.jinja"));
		await sleep(2000);
		const said = readOr(log);
		assert.equal(count(said, "Built in"), 1, said);
		assert.ok(!said.includes("Fresh tracks"), said);
		// The real edit after them is still seen.
		await changeAndWait(path.join(dir, "index.jinja"), "three", page, "three");
		assert.ok(readOr(log).includes("Fresh tracks in index.jinja\n"), readOr(log));
	} finally {
		await server.stop();
	}
});

// v8 #18: saving a stylesheet only PostCSS reads rebuilt the whole site (1.6 s, 0 pages changed).
// DELIBERATE (0.13.6): `serve.ignore` lists such files, and a change to one starts no build. A file
// the last build read (a Sass partial) rebuilds all the same, and the server says so once.
test("serve_skips_what_serve_ignore_lists", async () => {
	const dir = tempDir("serve-ignore");
	write(dir, {
		"ssqch.config.js": "import { sassPlugin } from \"ssqch/sass\";\nexport default { dirs: { input: \"src\" }, plugins: [sassPlugin({ files: { \"src/_scss/site.scss\": \"/site.css\" } })], serve: { ignore: [\"src/_css\", \"src/_scss/**\"] } };\n",
		"src/index.jinja": "one",
		"src/_css/main.css": "body { color: pine; }",
		"src/_scss/site.scss": "@use \"vars\";\nbody { color: vars.$pine; }\n",
		"src/_scss/_vars.scss": "$pine: #233b2b;\n",
	});
	const log = path.join(tempDir("serve-ignore-log"), "serve.log");
	const server = start(["serve", "--port", "0", "--root", dir], { logFile: log });
	try {
		const page = path.join(dir, "_site/index.html");
		await waitFor(page, "one");
		// The first build's summary, so the count below is only what the edit started.
		await waitFor(log, "Built in", 60_000);
		// A folder named covers what's in it (and Windows reports the folder itself as well).
		fs.writeFileSync(path.join(dir, "src/_css/main.css"), "body { color: gold; }");
		await sleep(2000);
		let said = readOr(log);
		assert.equal(count(said, "Built in"), 1, said);
		assert.ok(!said.includes("Fresh tracks"), said);
		// A partial the build read: rebuilt, with a word about the glob, once.
		await changeAndWait(path.join(dir, "src/_scss/_vars.scss"), "$pine: #a23e20;\n", path.join(dir, "_site/site.css"), "#a23e20");
		await changeAndWait(path.join(dir, "src/_scss/_vars.scss"), "$pine: #e8af43;\n", path.join(dir, "_site/site.css"), "#e8af43");
		said = readOr(log);
		// The server names files the way the platform writes them (`src\_scss` on Windows).
		assert.equal(count(said, `serve.ignore lists ${path.join("src", "_scss", "_vars.scss")}, but the last build read it, so a change to it rebuilds the site all the same`), 1, said);
		// A page is still seen. (Which file the line names isn't checked: a late event from the
		// partial's save can land in the same burst, and the line names the first.)
		await changeAndWait(path.join(dir, "src/index.jinja"), "two", page, "two");
	} finally {
		await server.stop();
	}
	// A glob that isn't one is the config's error; so is something that isn't a glob.
	write(dir, { "ssqch.config.js": "export default { serve: { ignore: [\"src/[css\"] } };\n" });
	let r = ssqch(["build", "--root", dir]);
	assert.ok(!r.ok && r.log.includes("serve.ignore: invalid glob"), r.log);
	write(dir, { "ssqch.config.js": "export default { serve: { ignore: 5 } };\n" });
	r = ssqch(["build", "--root", dir]);
	assert.ok(!r.ok && r.log.includes("serve.ignore must be a glob or an array of globs from the project root"), r.log);
});

// A config saved after the build process loaded it and before the server's watch began (during
// the first build, or a reload's) was missed until the next save (CI, in
// `serve_restarts_companions_on_reload`). DELIBERATE (0.13.5): the server compares what it
// loaded with what's there once it's watching, and reads the configuration again.
test("serve_reads_a_config_saved_before_its_watch_began", async () => {
	const dir = tempDir("serve-config-meanwhile");
	const marker = path.join(tempDir("serve-config-meanwhile-marker"), "loaded");
	const config = (word) => `import fs from "node:fs";\nexport default { data: { word: "${word}" }, beforeBuild: async () => { fs.writeFileSync(${JSON.stringify(marker)}, "${word}"); await new Promise((r) => setTimeout(r, 1500)); } };\n`;
	write(dir, { "index.jinja": "{{ word }}", "ssqch.config.js": config("pine") });
	const log = path.join(tempDir("serve-config-meanwhile-log"), "serve.log");
	const server = start(["serve", "--port", "0", "--root", dir], { logFile: log });
	try {
		// The first build has loaded the config and is in its hook: save the config now.
		await waitFor(marker, "pine");
		fs.writeFileSync(path.join(dir, "ssqch.config.js"), config("cedar"));
		await waitFor(path.join(dir, "_site/index.html"), "cedar");
		assert.ok(readOr(log).includes("Fresh tracks in ssqch.config.js (reading the configuration again)"), readOr(log));
	} finally {
		await server.stop();
	}
});

// a11y #21 (2 of 17 runs): an edit made during the first build, after it read the page and before
// the watch began, was never seen, and the old page was served with no word why. An agent that
// edits as soon as a page answers lands there. DELIBERATE (0.13.5): the watch begins first.
test("serve_sees_an_edit_made_during_its_first_build", async () => {
	const dir = tempDir("serve-edit-first-build");
	const marker = path.join(tempDir("serve-edit-first-build-marker"), "built");
	write(dir, { "index.jinja": "one", "ssqch.config.js": `import fs from "node:fs";\nexport default { afterBuild: async () => { fs.writeFileSync(${JSON.stringify(marker)}, "x"); await new Promise((r) => setTimeout(r, 1500)); } };\n` });
	const log = path.join(tempDir("serve-edit-first-build-log"), "serve.log");
	const server = start(["serve", "--port", "0", "--root", dir], { logFile: log });
	try {
		// The page is written and the build is in its hook: edit it now.
		await waitFor(marker, "x");
		fs.writeFileSync(path.join(dir, "index.jinja"), "two");
		await waitFor(path.join(dir, "_site/index.html"), "two");
		assert.ok(readOr(log).includes("Fresh tracks in index.jinja\n"), readOr(log));
	} finally {
		await server.stop();
	}
});

/** Waits (up to 20 s) until `log` has `text` `n` times. */
async function waitCount(log, text, n) {
	const started = Date.now();
	while (count(readOr(log), text) < n) {
		assert.ok(Date.now() - started < 20_000, `waiting for ${n} of ${JSON.stringify(text)}:\n${readOr(log)}`);
		await sleep(50);
	}
}

/** The dev server's build state for the browser (`/__ssqch/build`). */
async function buildState(port) {
	const response = await httpGet(port, "/__ssqch/build?v=&p=%2F");
	try { return JSON.parse(body(response)); } catch (e) { throw new Error(`${e.message}: ${response}`); }
}

// The half-typed tag a dev server sees most, in an include: an error at the include's line, and
// the server builds again once it's fixed.
test("serve_shows_a_syntax_error_in_an_include", async () => {
	const dir = tempDir("serve-include-syntax");
	write(dir, {
		"ssqch.config.js": "export default { dirs: { input: \"src\" }, templateFormats: [\"md\", \"njk\"] };\n",
		"src/_includes/layout.njk": "<html><body>{% include \"nav.njk\" %}<main>{{ content }}</main></body></html>",
		"src/_includes/nav.njk": "<nav>Cedar Trail</nav>",
		"src/index.md": "---\nlayout: layout.njk\n---\nPine Cone Crunch\n",
	});
	const log = path.join(tempDir("serve-include-syntax-log"), "serve.log");
	const ready = path.join(tempDir("serve-include-syntax-ready"), "ready.json");
	const server = start(["serve", "--port", "0", "--root", dir, "--ready-file", ready], { logFile: log });
	try {
		await waitFor(ready, "\"ok\": true");
		const port = JSON.parse(fs.readFileSync(ready, "utf8")).port;
		const page = path.join(dir, "_site/index.html");
		await changeAndWait(path.join(dir, "src/_includes/nav.njk"), "<nav>\n{% if %}</nav>", log, "Build failed:");
		await waitFor(log, "nav.njk:2: syntax error: unexpected end of block");
		const state = await buildState(port);
		assert.ok(state.error?.includes("nav.njk:2: syntax error: unexpected end of block"), JSON.stringify(state));
		// Still serving the page it had.
		assert.ok((await httpGet(port, "/")).includes("Cedar Trail"));
		await changeAndWait(path.join(dir, "src/_includes/nav.njk"), "<nav>Old Growth Trail</nav>", page, "Old Growth Trail");
		await waitFor(log, "Build recovered. Back on the trail. Built in");
		assert.equal((await buildState(port)).error, null);
		assert.ok(!readOr(log).includes("something large walked through"), readOr(log));
	} finally {
		await server.stop();
	}
});

// The site's code ends the build (`process.exit`), then the config is saved half-written: the
// last config that loaded goes on building.
test("serve_keeps_building_with_the_last_config_after_its_code_ends_the_build", async () => {
	const dir = tempDir("serve-exit");
	write(dir, {
		"ssqch.config.js": "export default { filters: { snack: (s) => { if (s === \"exit\") process.exit(3); return s + \" Squatch Snacks\"; } } };\n",
		"_data/flag.json": "{ \"v\": \"ok\" }",
		"index.jinja": "<p>{{ flag.v | snack }}</p>",
	});
	const log = path.join(tempDir("serve-exit-log"), "serve.log");
	const server = start(["serve", "--port", "0", "--root", dir], { logFile: log });
	try {
		const page = path.join(dir, "_site/index.html");
		await waitFor(page, "ok Squatch Snacks");
		await changeAndWait(path.join(dir, "_data/flag.json"), "{ \"v\": \"exit\" }", log, "Build failed:");
		// The config is saved a moment later, as a person would: in the Node build, another
		// process has loaded the last one by then. On a busy machine it may not have (the gap is
		// accepted, 2026-11-18), and the log says nothing builds until the config loads. Then the
		// good config goes back, its build ends its process again, and the save is tried again.
		const config = path.join(dir, "ssqch.config.js");
		const good = fs.readFileSync(config, "utf8");
		const since = (mark) => (fs.existsSync(log) ? fs.readFileSync(log, "utf8").slice(mark) : "");
		for (let attempt = 1; ; attempt++) {
			await sleep(3000);
			const mark = since(0).length;
			const answer = await (async () => {
				for (const started = Date.now(); Date.now() - started < 40_000;) {
					fs.writeFileSync(config, "export default { filters: ");
					for (const written = Date.now(); Date.now() - written < 1000; await sleep(50)) {
						const said = since(mark);
						if (said.includes("(still serving with the last configuration that loaded)")) return "kept";
						if (said.includes("(nothing builds until it loads")) return "gap";
					}
				}
				throw new Error(`no config error after saving a broken config; the log has ${JSON.stringify(since(0))}`);
			})();
			if (answer === "kept") break;
			assert.ok(attempt < 3, `saved in the gap three times: ${since(0)}`);
			const again = since(0).length;
			fs.writeFileSync(config, good);
			for (const started = Date.now(); !since(again).includes("Build failed:"); await sleep(50)) {
				if (Date.now() - started > 40_000) throw new Error(`the good config didn't build again; the log has ${JSON.stringify(since(0))}`);
			}
		}
		await changeAndWait(path.join(dir, "_data/flag.json"), "{ \"v\": \"fixed\" }", page, "fixed Squatch Snacks");
		await waitFor(log, "Build recovered. Back on the trail. Built in");
	} finally {
		await server.stop();
	}
});

// What the site's code throws after a build has reported (in a timer) fails the next build, with
// that error, and the one after builds.
test("serve_fails_the_next_build_with_an_error_thrown_after_one", async () => {
	const dir = tempDir("serve-timer");
	write(dir, {
		// `nap` waits on a timer of its own, so 0.7 (whose timers ran only while a build waited)
		// runs the one `ranger` left in the build before.
		"ssqch.config.js": "export default { filters: {\n  ranger: (s) => { if (s === \"timer\") setTimeout(() => { throw new Error(\"thrown from a ranger's timer\"); }, 1000); return s; },\n  nap: async (s) => { await new Promise((r) => setTimeout(r, 1)); return s; },\n} };\n",
		"_data/flag.json": "{ \"v\": \"ok\" }",
		"index.jinja": "<p>{{ flag.v | ranger }} {{ \"camp\" | nap }}</p>",
	});
	const log = path.join(tempDir("serve-timer-log"), "serve.log");
	const ready = path.join(tempDir("serve-timer-ready"), "ready.json");
	const server = start(["serve", "--port", "0", "--root", dir, "--ready-file", ready], { logFile: log });
	try {
		await waitFor(ready, "\"ok\": true");
		const port = JSON.parse(fs.readFileSync(ready, "utf8")).port;
		const page = path.join(dir, "_site/index.html");
		await changeAndWait(path.join(dir, "_data/flag.json"), "{ \"v\": \"timer\" }", page, "<p>timer camp</p>");
		// The timer has gone off.
		await sleep(2000);
		assert.ok(!readOr(log).includes("Build failed"), readOr(log));
		fs.writeFileSync(path.join(dir, "_data/flag.json"), "{ \"v\": \"later\" }");
		await waitFor(log, "Build failed:");
		await waitFor(log, "thrown from a ranger's timer");
		const state = await buildState(port);
		assert.ok(state.error?.includes("thrown from a ranger's timer"), JSON.stringify(state));
		await changeAndWait(path.join(dir, "_data/flag.json"), "{ \"v\": \"fixed\" }", page, "<p>fixed camp</p>");
		await waitFor(log, "Build recovered. Back on the trail. Built in");
		assert.equal(count(readOr(log), "Build failed:"), 1, readOr(log));
	} finally {
		await server.stop();
	}
});

// Ctrl-C reaches every process in the terminal's group. With a `serve.run` tool running and a
// build under way, ssqch stops it and says nothing more about the build or where it's serving.
// The tool and the hooks get the environment ssqch was given.
test("serve_stops_quietly_on_ctrl_c_during_a_build", unixOnly, async () => {
	const dir = tempDir("serve-ctrl-c");
	write(dir, {
		"bin/pinecss": "#!/bin/sh\necho \"pool=${UV_THREADPOOL_SIZE:-unset}\"\ncat > /dev/null\nwhile true; do sleep 0.2; done\n",
		"ssqch.config.js": "import fs from \"node:fs\";\nexport default {\n  dirs: { input: \"src\" },\n  serve: { run: [\"./bin/pinecss --watch\"] },\n  beforeBuild: async () => { if (fs.existsSync(\"slow\")) await new Promise((r) => setTimeout(r, 3000)); },\n  afterBuild: { run: \"echo hook pool=${UV_THREADPOOL_SIZE:-unset}\" },\n};\n",
		"src/index.html": "<p>camp</p>",
	});
	fs.chmodSync(path.join(dir, "bin/pinecss"), 0o755);
	const log = path.join(tempDir("serve-ctrl-c-log"), "serve.log");
	const server = start(["serve", "--port", "0", "--root", dir], { cwd: dir, logFile: log, detached: true, env: { UV_THREADPOOL_SIZE: undefined } });
	try {
		await waitFor(log, "[pinecss] pool=unset");
		await waitFor(log, "Squatch Watch is on.");
		assert.ok(readOr(log).includes("hook pool=unset"), readOr(log));
		write(dir, { slow: "" });
		await changeAndWait(path.join(dir, "src/index.html"), "<p>camp two</p>", log, "Fresh tracks in src");
		const before = readOr(log).length;
		await sleep(1000);
		process.kill(-server.pid, "SIGINT");
		const { code, signal } = await server.exited;
		assert.ok(code === 130 || signal === "SIGINT", `${code} ${signal}`);
		const after = readOr(log).slice(before);
		assert.ok(!after.includes("Build failed") && !after.includes("Serving "), after);
	} finally {
		await server.stop();
	}
});

// A folder renamed away and back again (an undo, a `git stash`) rebuilds each time.
// 0.7 took a folder renamed back for no change: it hashed a folder's contents as nothing, the same
// each time.
test("serve_rebuilds_for_a_folder_renamed_back", async () => {
	const dir = tempDir("serve-renamed");
	write(dir, {
		"ssqch.config.js": "export default { dirs: { input: \"src\" } };\n",
		"src/index.jinja": "{% for p in collections.all %}{{ p.url }} {% endfor %}",
		"src/trails/cedar.md": "Cedar\n",
	});
	const log = path.join(tempDir("serve-renamed-log"), "serve.log");
	const server = start(["serve", "--port", "0", "--root", dir], { logFile: log });
	try {
		const page = path.join(dir, "_site/index.html");
		await waitFor(page, "/trails/cedar/");
		// Past the server's wait for more changes after its first build.
		await sleep(1500);
		fs.renameSync(path.join(dir, "src/trails"), path.join(dir, "src/paths"));
		await waitFor(page, "/paths/cedar/");
		await sleep(1500);
		fs.renameSync(path.join(dir, "src/paths"), path.join(dir, "src/trails"));
		await waitFor(page, "/trails/cedar/");
		await sleep(1500);
		fs.renameSync(path.join(dir, "src/trails"), path.join(dir, "src/paths"));
		await waitFor(page, "/paths/cedar/");
	} finally {
		await server.stop();
	}
});

// A config file that's deleted leaves the defaults building; one that's put back is read again.
// 0.7 didn't watch for a config file that wasn't loaded, so one put back went unread.
test("serve_reads_a_config_file_put_back", async () => {
	for (const input of ["src", "."]) {
		const dir = tempDir("serve-config-back");
		const config = (greeting) => `export default { dirs: { input: ${JSON.stringify(input)} }, data: { greeting: "${greeting}" } };\n`;
		write(dir, { "ssqch.config.js": config("howdy"), [path.join(input, "index.jinja")]: "{{ greeting }}, ranger" });
		const log = path.join(tempDir("serve-config-back-log"), "serve.log");
		const server = start(["serve", "--port", "0", "--root", dir], { logFile: log });
		try {
			const page = path.join(dir, "_site/index.html");
			await waitFor(page, "howdy, ranger");
			await sleep(1500);
			fs.rmSync(path.join(dir, "ssqch.config.js"));
			await waitCount(log, "(reading the configuration again)", 1);
			await waitCount(log, "Built in", 2);
			await changeAndWait(path.join(dir, "ssqch.config.js"), config("hello"), page, "hello, ranger");
		} finally {
			await server.stop();
		}
	}
});

// What the server answers for what it can't serve: 0.7's statuses, types and lengths.
test("serve_answers_what_it_cant_serve_as_it_did", async () => {
	const dir = tempDir("serve-answers");
	write(dir, {
		"ssqch.config.js": "export default { dirs: { input: \"src\", output: \"dist\" }, base: \"/trail/\" };\n",
		"src/index.html": "<p>camp</p>",
	});
	for (const built of [false, true]) {
		if (built) ssqch(["build", "--root", dir]);
		const ready = path.join(tempDir("serve-answers-ready"), "ready.json");
		const server = start(["serve", ...(built ? ["--built"] : []), "--port", "0", "--root", dir, "--ready-file", ready], { logFile: path.join(tempDir("serve-answers-log"), "serve.log") });
		try {
			await waitFor(ready, "\"schemaVersion\"");
			const port = JSON.parse(fs.readFileSync(ready, "utf8")).port;
			const outside = await httpGet(port, "/other/");
			assert.ok(outside.startsWith("HTTP/1.1 404") && /\r\nContent-Type: text\/plain; charset=UTF-8\r\n/i.test(outside), outside);
			// No file has a NUL in its name: a page that isn't there.
			const nul = await httpGet(port, "/trail/%00");
			assert.ok(nul.startsWith("HTTP/1.1 404") && nul.includes(built ? "Not found: /trail/\0" : "The trail goes cold"), nul);
			// A request Node or 0.7 can't read: a 400 that says how long it is.
			const spaced = await httpGet(port, "/trail/a b");
			assert.ok(spaced.startsWith("HTTP/1.1 400") && /\r\nContent-Length: 0\r\n/i.test(spaced), spaced);
		} finally {
			await server.stop();
		}
	}
});

// Added in 0.12, from the fresh vuejs.org run: a `beforeBuild` hook that builds the site's Vue
// components can skip that when only Markdown changed, if it knows what changed.
test("serve_tells_before_build_what_changed", async () => {
	const dir = tempDir("serve-changed");
	write(dir, {
		"ssqch.config.js": "export default { dirs: { input: \"src\" }, beforeBuild: ({ changed }) => { globalThis.changes = changed === undefined ? \"everything\" : changed.join(\" \"); }, filters: { changes: () => globalThis.changes } };\n",
		"src/index.jinja": "{{ changes() }}|one",
	});
	// The log goes outside the project: the server watches its root, and a log line written while
	// the edit lands was itself a change (`./src/index.jinja ./serve.log`, CI on Linux, 2026-11-22).
	const log = path.join(tempDir("serve-changed-log"), "serve.log");
	const server = start(["serve", "--port", "0", "--root", dir], { logFile: log });
	try {
		const page = path.join(dir, "_site/index.html");
		await waitFor(page, "everything|one");
		await changeAndWait(path.join(dir, "src/index.jinja"), "{{ changes() }}|two", page, "./src/index.jinja|two");
	} finally {
		await server.stop();
	}
});

// Added in 0.13 (the audit's plan, step 4): a request that asks for `text/markdown` by name, as
// Claude Code, Cursor and OpenCode do, gets the page's Markdown copy, from both servers; a
// browser's request gets the page, and both say they vary by `Accept`.
test("serve_answers_markdown_to_a_request_that_asks_for_it", async () => {
	const dir = tempDir("serve-markdown");
	write(dir, {
		"ssqch.config.js": "import { llmsPlugin } from \"ssqch/llms\";\nexport default { plugins: [llmsPlugin()] };\n",
		"guide/intro.md": "# Getting started\n\nPack water, and a snack for the stump.\n",
		"plain.html": "---\nllms: false\n---\n<p>No copy here.</p>",
	});
	ssqch(["build", "--root", dir, "-q"]);
	for (const built of [false, true]) {
		const ready = path.join(tempDir("serve-markdown-ready"), "ready.json");
		const server = start(["serve", ...(built ? ["--built"] : []), "--port", "0", "--root", dir, "--ready-file", ready], { logFile: path.join(tempDir("serve-markdown-log"), "serve.log") });
		try {
			await waitFor(ready, "\"schemaVersion\"");
			const port = JSON.parse(fs.readFileSync(ready, "utf8")).port;
			const md = await httpGet(port, "/guide/intro/", { Accept: "text/markdown, text/html;q=0.9" });
			assert.ok(md.startsWith("HTTP/1.1 200") && /\r\nContent-Type: text\/markdown; charset=utf-8\r\n/i.test(md) && /\r\nVary: Accept/i.test(md), `${built ? "--built" : "serve"}: ${md}`);
			assert.equal(body(md), "# Getting started\n\nPack water, and a snack for the stump.\n");
			const page = await httpGet(port, "/guide/intro/", { Accept: "text/html,application/xhtml+xml,*/*;q=0.8" });
			assert.ok(/\r\nContent-Type: text\/html/i.test(page) && /\r\nVary: Accept/i.test(page) && body(page).includes("<h1"), page);
			// A page without a copy is the page, whatever the request asks for.
			const plain = await httpGet(port, "/plain/", { Accept: "text/markdown" });
			assert.ok(/\r\nContent-Type: text\/html/i.test(plain) && !/\r\nVary: Accept\r\n/i.test(plain), plain);
			// The copy at its own address is Markdown too.
			const file = await httpGet(port, "/guide/intro/index.md");
			assert.ok(/\r\nContent-Type: text\/markdown; charset=utf-8\r\n/i.test(file), file);
		} finally {
			await server.stop();
		}
	}
});

// From the move to Node: a promise in the site's code that never settles, while something else
// keeps Node running (a setInterval in the config), wedged every rebuild with no word. DELIBERATE
// (0.13.5): after a minute with nothing done (2 s here), the server ends the build, says what it
// waited on, and the next change builds in a new process. SSQCH_STUCK_MS is the tests' limit.
test("serve_ends_a_build_that_stops_making_progress", async () => {
	const dir = tempDir("serve-stuck");
	write(dir, {
		"ssqch.config.js": "setInterval(() => {}, 1000);\nexport default { filters: { never: () => new Promise(() => {}) } };\n",
		"index.jinja": "{{ never() }}",
	});
	const log = path.join(tempDir("serve-stuck-log"), "serve.log");
	const ready = path.join(tempDir("serve-stuck-ready"), "ready.json");
	const server = start(["serve", "--port", "0", "--root", dir, "--ready-file", ready], { logFile: log, env: { SSQCH_STUCK_MS: "2000" } });
	try {
		await waitFor(log, "the build stopped making progress");
		const said = readOr(log);
		assert.ok(said.includes("in index.jinja: the build stopped making progress: for 2 s nothing happened, and it was waiting on filter `never` (rendering index.jinja)."), said);
		assert.ok(said.includes("ssqch ended that build; the next change builds again. If it was still working (a long wait on purpose), make it a `{ run: \"...\" }` command"), said);
		await waitFor(ready, "\"ok\": false");
		// Fixed, the next change builds, in a new process.
		await changeAndWait(path.join(dir, "index.jinja"), "camp", path.join(dir, "_site/index.html"), "camp");
	} finally {
		await server.stop();
	}
});

// A `run` command holds the build's process while it runs (spawnSync), so the server is told
// first: one that takes longer than the limit (Pagefind's first download) isn't ended.
test("serve_lets_a_long_run_command_finish", async () => {
	const dir = tempDir("serve-long-command");
	write(dir, {
		"ssqch.config.js": "export default { afterBuild: [{ run: \"node -e \\\"setTimeout(() => {}, 5000)\\\"\" }] };\n",
		"index.jinja": "camp",
	});
	const log = path.join(tempDir("serve-long-command-log"), "serve.log");
	const server = start(["serve", "--port", "0", "--root", dir], { logFile: log, env: { SSQCH_STUCK_MS: "2500" } });
	try {
		await waitFor(log, "Squatch Watch is on.");
		assert.ok(!readOr(log).includes("stopped"), readOr(log));
		assert.ok(readOr(log).includes("First confirmed sighting. Built in"), readOr(log));
	} finally {
		await server.stop();
	}
});

// Code that never returns holds the event loop, so the reports stop: the server ends it too.
test("serve_ends_a_build_that_stops_answering", async () => {
	const dir = tempDir("serve-loop");
	write(dir, {
		"ssqch.config.js": "export default { filters: { forever: () => { for (;;) {} } } };\n",
		"index.jinja": "{{ forever() }}",
	});
	const log = path.join(tempDir("serve-loop-log"), "serve.log");
	const server = start(["serve", "--port", "0", "--root", dir], { logFile: log, env: { SSQCH_STUCK_MS: "2000" } });
	try {
		await waitFor(log, "the build stopped answering");
		assert.ok(readOr(log).includes("the build stopped answering for 2 s"), readOr(log));
		await changeAndWait(path.join(dir, "index.jinja"), "camp", path.join(dir, "_site/index.html"), "camp");
	} finally {
		await server.stop();
	}
});

// An IPv6 address the server listens on is in brackets in its URLs, which a URL needs to tell its
// colons from the port's: `http://::ffff:127.0.0.1:58738/` parsed nowhere (the 2026-11-24 review).
test("serve_brackets_an_ipv6_host_in_its_urls", async () => {
	const dir = tempDir("serve-ipv6");
	write(dir, { "ssqch.config.js": "export default { dirs: { input: \"src\", output: \"dist\" } };\n", "src/index.html": "<p>camp</p>" });
	const { server, info } = await serveSite(dir, ["--host", "::ffff:127.0.0.1"]);
	try {
		assert.match(info.url, /^http:\/\/\[::ffff:127\.0\.0\.1\]:\d+\/$/);
		// It parses, as an IPv6 host (URL writes it in its own form, `[::ffff:7f00:1]`).
		assert.ok(new URL(info.url).hostname.startsWith("[::ffff:"), info.url);
		assert.ok(server.log().includes(`at ${info.url}`), server.log());
	} finally {
		await server.stop();
	}
});

// `SSQCH_CHECK_REBUILDS=1` (the dev server's design, stage 0): after each rebuild, a clean build
// of the same files in a new process, compared byte for byte with what the rebuild wrote. A site
// whose pages list a collection, highlight a fence and copy a file passes; one whose data
// function counts its calls (state kept in the builder's process, as a stale cache would be)
// doesn't, and the check names the page. `SSQCH_SERVE_TIMELINE` writes each step's time.
test("serve_checks_each_rebuild_against_a_clean_build", async () => {
	const dir = tempDir("serve-check");
	write(dir, {
		"ssqch.config.js": "export default { dirs: { input: \"src\", output: \"dist\" }, passthrough: [\"src/camp.txt\"] };\n",
		"src/index.jinja": "{% for post in collections.posts %}<a href=\"{{ post.url }}\">{{ post.data.title }}</a>{% endfor %}",
		"src/posts/posts.json": "{ \"tags\": \"posts\" }",
		"src/posts/hike.md": "---\ntitle: Cedar Trail\n---\n```js\nconst cones = 3;\n```\n",
		"src/posts/stump.md": "---\ntitle: The stump\n---\nStill there.\n",
		"src/camp.txt": "pine cones",
	});
	const timeline = path.join(tempDir("serve-check-times"), "times.jsonl");
	// The log beside the project, not in its root, which is watched for config files.
	const log = path.join(tempDir("serve-check-log"), "serve.log");
	const server = start(["serve", "--port", "0", "--root", dir], { logFile: log, env: { SSQCH_CHECK_REBUILDS: "1", SSQCH_SERVE_TIMELINE: timeline } });
	try {
		await waitFor(path.join(dir, "dist/index.html"), "Cedar Trail");
		await changeAndWait(path.join(dir, "src/posts/hike.md"), "---\ntitle: Old Growth Trail\n---\n```js\nconst cones = 4;\n```\n", path.join(dir, "dist/index.html"), "Old Growth Trail");
		const said = await waitFor(log, "check-rebuilds: ");
		const hike = path.join("src", "posts", "hike.md");
		assert.ok(said.includes(`check-rebuilds: the rebuild after ${hike} wrote what a clean build writes (4 files the same)`), said);
		const lines = readOr(timeline).trim().split("\n").map((line) => JSON.parse(line));
		const rebuild = lines.find((line) => line.kind === "rebuild");
		assert.ok(rebuild && lines.some((line) => line.kind === "check"), readOr(timeline));
		// Each step after the one before it, on one clock.
		const b = rebuild.builder;
		const steps = [rebuild.heard, rebuild.debounced, rebuild.asked, b.received, b.started, b.finished, b.said, rebuild.built, rebuild.held, rebuild.published, rebuild.said];
		assert.ok(steps.every((t, i) => typeof t === "number" && (i === 0 || t >= steps[i - 1])), JSON.stringify(rebuild));
		assert.deepEqual(b.phases.map(([name]) => name).slice(0, 2), ["setup", "data"]);
	} finally {
		await server.stop();
	}

	const counting = tempDir("serve-check-stale");
	write(counting, {
		"ssqch.config.js": "let builds = 0;\nexport default { dirs: { input: \"src\", output: \"dist\" }, data: { builds: () => ++builds } };\n",
		"src/index.jinja": "build {{ builds }}",
		"src/camp.jinja": "camp",
	});
	const staleLog = path.join(tempDir("serve-check-stale-log"), "serve.log");
	const again = start(["serve", "--port", "0", "--root", counting], { logFile: staleLog, env: { SSQCH_CHECK_REBUILDS: "1" } });
	try {
		await waitFor(path.join(counting, "dist/index.html"), "build 1");
		await changeAndWait(path.join(counting, "src/camp.jinja"), "camp two", path.join(counting, "dist/camp/index.html"), "camp two");
		const said = await waitFor(staleLog, "check-rebuilds: ");
		assert.ok(said.includes(`check-rebuilds: the rebuild after ${path.join("src", "camp.jinja")} isn't what a clean build writes: 1 differ (index.html)`), said);
	} finally {
		await again.stop();
	}

	// A site whose input folder is its root (a Jekyll layout): the clean build writes elsewhere,
	// and still leaves the served output out of its input, as the build does with its own.
	const rooted = tempDir("serve-check-rooted");
	write(rooted, {
		"ssqch.config.js": "export default { dirs: { output: \"dist\" } };\n",
		"index.html": "camp",
		"cedar.md": "# Cedar Trail\n",
	});
	const rootedLog = path.join(tempDir("serve-check-rooted-log"), "serve.log");
	const third = start(["serve", "--port", "0", "--root", rooted], { logFile: rootedLog, env: { SSQCH_CHECK_REBUILDS: "1" } });
	try {
		await waitFor(path.join(rooted, "dist/cedar/index.html"), "Cedar Trail");
		await changeAndWait(path.join(rooted, "cedar.md"), "# Old Growth Trail\n", path.join(rooted, "dist/cedar/index.html"), "Old Growth Trail");
		const said = await waitFor(rootedLog, "check-rebuilds: ");
		assert.ok(said.includes("check-rebuilds: the rebuild after cedar.md wrote what a clean build writes (2 files the same)"), said);
	} finally {
		await third.stop();
	}
});

// The timeline times a rebuild from the change that started it, after the save. A `serve.run`
// tool that writes into the output after each build (Tailwind scanning the pages) is heard while
// the server waits for it, and the next rebuild was stamped with that: 1.8 s before its own save,
// on the blog.
test("serve_times_each_rebuild_from_its_own_change", async () => {
	const dir = tempDir("serve-times");
	write(dir, {
		"ssqch.config.js": "export default { dirs: { input: \"src\", output: \"dist\" }, serve: { run: [\"node tool.mjs\"] } };\n",
		// It writes the stylesheet at the start, and again after each build writes the page.
		"tool.mjs": "import fs from \"node:fs\";\nconst out = process.env.SSQCH_OUTPUT;\nlet n = 0;\nconst css = () => fs.writeFileSync(`${out}/app.css`, `body { --n: ${++n}; }`);\nfs.mkdirSync(out, { recursive: true });\ncss();\nfs.watch(out, (event, name) => { if (name === \"index.html\") setTimeout(css, 20); });\nprocess.stdin.on(\"end\", () => process.exit());\nprocess.stdin.resume();\n",
		"src/index.jinja": "<link rel=\"stylesheet\" href=\"/app.css\">camp 0",
	});
	const timeline = path.join(tempDir("serve-times-line"), "times.jsonl");
	const log = path.join(tempDir("serve-times-log"), "serve.log");
	const server = start(["serve", "--port", "0", "--root", dir], { logFile: log, env: { SSQCH_SERVE_TIMELINE: timeline } });
	const rebuilds = () => readOr(timeline).split("\n").filter(Boolean).map((line) => JSON.parse(line)).filter((line) => line.kind === "rebuild" && line.file === path.join("src", "index.jinja"));
	try {
		await waitFor(path.join(dir, "dist/index.html"), "camp 0");
		for (let i = 1; i <= 2; i++) {
			// Past the tool's write for the build before.
			await sleep(1000);
			const saved = Date.now();
			await changeAndWait(path.join(dir, "src/index.jinja"), `<link rel="stylesheet" href="/app.css">camp ${i}`, path.join(dir, "dist/index.html"), `camp ${i}`);
			const started = Date.now();
			while (rebuilds().length < i) {
				assert.ok(Date.now() - started < 10_000, `no timeline line for edit ${i}:\n${readOr(timeline)}\n${readOr(log)}`);
				await sleep(20);
			}
			const line = rebuilds()[i - 1];
			assert.ok(line.heard >= saved, `edit ${i} saved at ${saved}, heard at ${line.heard}: ${JSON.stringify(line)}`);
		}
	} finally {
		await server.stop();
	}
});
