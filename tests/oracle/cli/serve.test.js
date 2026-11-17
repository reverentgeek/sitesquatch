// From crates/ssqch/tests/cli.rs.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { ssqch, tempDir, write } from "../lib/ssqch.js";
import { start, sleep, waitFor, changeAndWait, httpGet, body } from "../lib/serve.js";

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
	const script = "#!/bin/sh\necho $$ > \"$SSQCH_INPUT/../watcher.pid\"\nmkdir -p \"$SSQCH_OUTPUT/assets\"\necho 'body { color: pine; }' > \"$SSQCH_OUTPUT/assets/app.css\"\necho \"wrote app.css, serving=$SSQCH_SERVING\"\ncat > /dev/null\nwhile true; do sleep 0.2; done\n";
	write(dir, { "bin/pinecss": script });
	fs.chmodSync(path.join(dir, "bin/pinecss"), 0o755);
	write(dir, {
		"ssqch.config.js": "export default { dirs: { input: \"src\" }, serve: { run: [\"./bin/pinecss --watch\"] } };\n",
		"src/index.html": "<link rel=\"stylesheet\" href=\"/assets/app.css\"><p>camp</p>",
	});
	const log = path.join(tempDir("serve-companions-log"), "serve.log");
	const server = start(["serve", "--port", "0", "--root", dir], { logFile: log });
	try {
		await waitFor(log, "[pinecss] wrote app.css, serving=true");
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
	// Not an option it knows: an error that says so.
	write(dir, { "ssqch.config.js": "export default { serve: { runs: [\"x\"] } };\n" });
	const r = ssqch(["build", "--root", dir]);
	assert.ok(!r.ok && r.log.includes("serve: \"runs\" isn't an option (options: run)"), r.log);
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
		const said = "/assets/app.css is linked but nothing wrote it to _site. If a tool makes it, run its watcher with `serve.run` (see \"CSS and JavaScript\" in the README)";
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

// A site whose input folder is the project root (the default) has ssqch's
// own `.cache` and the output inside what's watched. Writing them isn't a change.
test("serve_does_not_rebuild_for_its_own_files", async () => {
	const dir = tempDir("serve-root");
	write(dir, {
		"index.jinja": "one {{ 1 + 1 }}",
		"ssqch.config.js": "export default { clean: true };\n",
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
		assert.equal(count(said, "First confirmed siting. Built in"), 1, said);
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
