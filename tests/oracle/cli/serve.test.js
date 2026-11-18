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
		fs.writeFileSync(path.join(dir, "src/_includes/nav.njk"), "<nav>\n{% if %}</nav>");
		await waitFor(log, "Build failed:");
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
		fs.writeFileSync(path.join(dir, "_data/flag.json"), "{ \"v\": \"exit\" }");
		await waitFor(log, "Build failed:");
		// The config is saved a moment later, as a person would: in the Node build, another
		// process has loaded the last one by then.
		await sleep(3000);
		await changeAndWait(path.join(dir, "ssqch.config.js"), "export default { filters: ", log, "Config error:");
		await waitFor(log, "(still serving with the last configuration that loaded)");
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
