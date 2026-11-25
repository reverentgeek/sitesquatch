// From crates/ssqch/tests/cli.rs.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { ssqch, tempDir, write, read, exists } from "../lib/ssqch.js";
import { start, waitFor, changeAndWait, httpGet, live, sleep } from "../lib/serve.js";

const READY = "\"schemaVersion\": 1";
const readOr = (file) => { try { return fs.readFileSync(file, "utf8"); } catch { return ""; } };

/** Polls `fn` until it returns something truthy (up to `timeout` ms); fails with `message()` otherwise. */
async function until(fn, message, timeout = 20_000) {
	const started = Date.now();
	for (;;) {
		const found = await fn();
		if (found) return found;
		if (Date.now() - started > timeout) throw new Error(message());
		await sleep(50);
	}
}

test("serve_writes_a_ready_file", async () => {
	const dir = tempDir("serve-ready");
	write(dir, {
		"ssqch.config.js": "export default { dirs: { input: \"src\", output: \"dist\" }, base: \"/docs/\" };\n",
		"src/index.md": "Ready *now*\n",
	});
	const ready = path.join(dir, "ready.json");
	// One left by an earlier run mustn't count.
	fs.writeFileSync(ready, "{ \"port\": 1 }");
	const server = start(["serve", "--port", "0", "--ready-file", ready, "--root", dir], { logFile: path.join(dir, "serve.log") });
	try {
		await waitFor(ready, READY);
		const info = JSON.parse(fs.readFileSync(ready, "utf8"));
		const port = info.port;
		assert.ok(port > 1, JSON.stringify(info));
		assert.equal(info.url, `http://localhost:${port}/docs/`);
		assert.equal(info.base, "/docs");
		assert.equal(info.ok, true);
		assert.equal(info.pid, server.pid);
		const output = info.output;
		assert.ok(path.isAbsolute(output) && path.basename(output) === "dist", JSON.stringify(info));
		// The first build is done by the time the file is there, and the site is being served.
		assert.ok(fs.readFileSync(path.join(output, "index.html"), "utf8").includes("Ready <em>now</em>"));
		const page = await httpGet(port, "/docs/");
		assert.ok(page.startsWith("HTTP/1.1 200") && page.includes("Ready <em>now</em>"), page);
		assert.ok(page.includes("X-Powered-By: pine cones"), page);

		// A page that isn't there, in a site with no 404.html: the server's own page, which is never written.
		fs.mkdirSync(path.join(output, "contact"), { recursive: true });
		fs.writeFileSync(path.join(output, "contact/index.html"), "<p>Contact</p>");
		let missing = await httpGet(port, "/docs/contactt/");
		assert.ok(missing.startsWith("HTTP/1.1 404") && missing.includes("The trail goes cold at <code>/contactt/</code>"), missing);
		assert.ok(missing.includes("Did you mean <a href=\"/docs/contact/\">/contact/</a>?") && missing.includes("<a href=\"/docs/\">Back to the trailhead</a>"), missing);
		assert.ok(missing.includes("<script src=\"/__ssqch/live.js\" data-build=") && !fs.existsSync(path.join(output, "404.html")), missing);
		// The site's own 404.html wins.
		fs.writeFileSync(path.join(output, "404.html"), "<p>Mine</p>");
		missing = await httpGet(port, "/docs/contactt/");
		assert.ok(missing.startsWith("HTTP/1.1 404") && missing.includes("<p>Mine</p>") && !missing.includes("trail goes cold"), missing);
		// Outside the base.
		const outside = await httpGet(port, "/contact/");
		assert.ok(outside.startsWith("HTTP/1.1 404") && outside.includes("Wrong trailhead: this site is served under /docs/ (its `base`)."), outside);

		// A port something else has.
		const r = ssqch(["serve", "--port", String(port), "--root", dir]);
		assert.ok(!r.ok && r.log.includes(`can't listen on port ${port}: something else is squatting on it (--port 0 picks a free one)`), r.log);
	} finally {
		await server.stop();
	}
});

// A deleted or renamed page's file stays in the output with leaveNoTrace off (its default), as
// ssqch build leaves it, and the dev server served it: the page was still there while serving.
// The server answers it as not found, and a page put back is served again.
test("serve_doesnt_serve_a_deleted_page", async () => {
	const dir = tempDir("serve-deleted");
	write(dir, { "ssqch.config.js": "export default { dirs: { input: \"src\", output: \"dist\" } };\n", "src/index.md": "Home\n", "src/cedar.md": "Cedar Trail\n" });
	const ready = path.join(dir, "ready.json");
	const log = path.join(tempDir("serve-deleted-log"), "serve.log");
	const server = start(["serve", "--port", "0", "--ready-file", ready, "--root", dir], { logFile: log });
	try {
		await waitFor(ready, READY);
		const port = JSON.parse(fs.readFileSync(ready, "utf8")).port;
		assert.ok((await httpGet(port, "/cedar/")).startsWith("HTTP/1.1 200"));
		fs.rmSync(path.join(dir, "src/cedar.md"));
		await until(async () => (await httpGet(port, "/cedar/")).startsWith("HTTP/1.1 404"), () => readOr(log));
		assert.ok(exists(dir, "dist/cedar/index.html"), "the file stays, as ssqch build leaves it");
		write(dir, { "src/cedar.md": "Cedar Trail again\n" });
		await until(async () => (await httpGet(port, "/cedar/")).includes("Cedar Trail again"), () => readOr(log));
	} finally {
		await server.stop();
	}
});

// A browser hears a rebuild at once: the server pushes it on /__ssqch/events, where a page
// asked every 0.7 s (0.35 s late on average). The stream's first answer comes when it opens.
test("serve_pushes_each_change_to_the_browser", async () => {
	const dir = tempDir("serve-push");
	write(dir, { "ssqch.config.js": "export default { dirs: { input: \"src\", output: \"dist\" } };\n", "src/index.md": "Home\n" });
	const ready = path.join(dir, "ready.json");
	const server = start(["serve", "--port", "0", "--ready-file", ready, "--root", dir], { logFile: path.join(tempDir("serve-push-log"), "serve.log") });
	const http = await import("node:http");
	let stream;
	try {
		await waitFor(ready, READY);
		const port = JSON.parse(fs.readFileSync(ready, "utf8")).port;
		const first = (await live(port, "", "/")).id;
		const heard = [];
		await new Promise((resolve, reject) => {
			stream = http.get({ host: "127.0.0.1", port, path: `/__ssqch/events?v=${first}&p=%2F` }, (res) => {
				assert.match(res.headers["content-type"], /^text\/event-stream/);
				res.setEncoding("utf8");
				let buffered = "";
				res.on("data", (chunk) => {
					buffered += chunk;
					for (let at = buffered.indexOf("\n\n"); at !== -1; at = buffered.indexOf("\n\n")) {
						const event = buffered.slice(0, at);
						buffered = buffered.slice(at + 2);
						if (event.startsWith("data: ")) heard.push(JSON.parse(event.slice(6)));
					}
				});
				resolve();
			}).on("error", reject);
		});
		await until(() => heard.length >= 1, () => JSON.stringify(heard));
		assert.deepEqual([heard[0].id, heard[0].reload], [first, false], "it answers when it opens");
		fs.writeFileSync(path.join(dir, "src/index.md"), "Home again\n");
		const news = await until(() => heard.find((h) => h.id > first), () => JSON.stringify(heard));
		assert.equal(news.reload, true, JSON.stringify(news));
	} finally {
		stream?.destroy();
		await server.stop();
	}
});

// The dev server reloads a browser only for the page it's showing, and shows it a build that failed.
test("serve_tells_the_browser_what_changed", async () => {
	const dir = tempDir("serve-live");
	write(dir, {
		"ssqch.config.js": "export default { dirs: { input: \"src\", output: \"dist\" }, passthrough: { \"src/site.css\": \"site.css\" } };\n",
		"src/index.md": "Home\n",
		"src/about.md": "About\n",
		"src/site.css": "body { color: green }\n",
	});
	const ready = path.join(dir, "ready.json");
	const log = path.join(dir, "serve.log");
	const server = start(["serve", "--port", "0", "--ready-file", ready, "--root", dir], { logFile: log });
	try {
		await waitFor(ready, READY);
		const port = JSON.parse(fs.readFileSync(ready, "utf8")).port;
		const said = () => readOr(log);
		// The log comes through a pipe, so its last line may arrive after the ready file.
		const report = await waitFor(log, "Serving ");
		assert.ok(report.includes("Pages   2 written from 2 templates, ") && report.includes(" (2 changed)\n"), report);
		// The address comes after the build's report, so a long build doesn't bury it.
		assert.ok(report.indexOf("Built in") !== -1 && report.indexOf("Built in") < report.indexOf("Serving "), report);

		// A browser that has just opened the page learns where things stand.
		const first = await live(port, "", "/");
		assert.deepEqual([first.error, first.reload], [null, false], JSON.stringify(first));
		const since = String(first.id);
		// The page it gets has the script, which isn't in the file: a file of the server's (so a
		// site's Content-Security-Policy allows it), with the build the page was sent from.
		const sent = await httpGet(port, "/");
		assert.ok(sent.includes(`<script src="/__ssqch/live.js" data-build="${since}"></script>`) && !read(dir, "dist/index.html").includes("__ssqch"), sent);
		assert.ok((await httpGet(port, "/__ssqch/live.js")).includes("/__ssqch/build?v=") && (await httpGet(port, "/__ssqch/overlay.css")).includes("section"));

		// Another page changes: only a browser showing that page reloads.
		await changeAndWait(path.join(dir, "src/about.md"), "About us\n", path.join(dir, "dist/about/index.html"), "About us");
		await waitFor(log, " (1 changed)\n");
		// And again after each rebuild.
		await waitFor(log, "Fresh tracks in src");
		await until(() => said().split(". Squatch Watch is on.").length - 1 >= 2, said);
		assert.equal((await live(port, since, "/")).reload, false);
		assert.equal((await live(port, since, "/about/")).reload, true);

		// A stylesheet is swapped in place.
		await changeAndWait(path.join(dir, "src/site.css"), "body { color: brown }\n", path.join(dir, "dist/site.css"), "brown");
		let now;
		await until(async () => {
			now = await live(port, since, "/");
			return JSON.stringify(now.css) === JSON.stringify(["/site.css"]);
		}, () => `the stylesheet never changed: ${JSON.stringify(now)}\n${said()}`);
		assert.equal(now.reload, false, JSON.stringify(now));

		// A build that fails is the browser's to show, and the page it has stays.
		const since2 = String((await live(port, "", "/")).id);
		fs.writeFileSync(path.join(dir, "src/index.md"), "{{ nope( }}\n");
		let broken;
		await until(async () => {
			broken = await live(port, since2, "/");
			return broken.error !== null && broken.error !== undefined;
		}, () => `the build never failed:\n${said()}`);
		assert.ok(broken.error.includes("index.md") && broken.reload === false, JSON.stringify(broken));
		assert.ok((await httpGet(port, "/")).includes("Home"));
		// The tab's icon, for a site without one: each page links to it. And the broken-build one.
		const page = await httpGet(port, "/");
		assert.ok(page.includes(`<link rel="icon" href="/__ssqch/favicon.svg" type="image/svg+xml">`), page);
		for (const icon of ["/__ssqch/favicon.svg", "/favicon.ico", "/__ssqch/favicon-error.svg"]) {
			const response = await httpGet(port, icon);
			assert.ok(response.startsWith("HTTP/1.1 200") && response.includes("image/svg+xml") && response.includes("<svg "), `${icon}: ${response}`);
		}
		// Fixed: the error goes, and the page (the same as before it broke) doesn't reload.
		const since3 = String(broken.id);
		fs.writeFileSync(path.join(dir, "src/index.md"), "Home\n");
		let fixed;
		await until(async () => {
			fixed = await live(port, since3, "/");
			return fixed.error === null || fixed.error === undefined;
		}, () => `the build never worked again:\n${said()}`);
		assert.equal(fixed.reload, false, JSON.stringify(fixed));
	} finally {
		await server.stop();
	}
});

// `ssqch serve --built` (and `ssqch preview`) serves the output as it is: no build, no reload
// script, gzip for text.
test("serve_built_serves_the_output_as_it_is", async () => {
	const dir = tempDir("serve-built");
	write(dir, {
		"ssqch.config.js": "export default { dirs: { input: \"src\", output: \"dist\" } };\n",
		"src/index.md": "Home\n",
	});
	let r = ssqch(["serve", "--built", "--root", dir]);
	assert.ok(!r.ok && r.log.includes("dist doesn't exist: build the site first (ssqch build), then serve it with ssqch serve --built"), r.log);
	write(dir, {
		"dist/index.html": `<html><head></head><body>${"Pine cones. ".repeat(60)}</body></html>`,
		"dist/404.html": "Lost",
	});
	const ready = path.join(dir, "ready.json");
	const log = path.join(dir, "serve.log");
	const server = start(["preview", "--port", "0", "--ready-file", ready, "--root", dir], { logFile: log });
	try {
		await waitFor(ready, READY);
		const port = JSON.parse(fs.readFileSync(ready, "utf8")).port;
		const page = await httpGet(port, "/");
		assert.ok(page.startsWith("HTTP/1.1 200") && page.includes("Pine cones.") && !page.includes("<script") && !page.includes("__ssqch"), page);
		assert.ok((await httpGet(port, "/nope/")).startsWith("HTTP/1.1 404") && (await httpGet(port, "/nope/")).endsWith("Lost"));
		const gzipped = await httpGet(port, "/", { "Accept-Encoding": "gzip, br" });
		assert.ok(gzipped.includes("Content-Encoding: gzip") && !gzipped.includes("Pine cones."), gzipped);
		const said = await waitFor(log, "Serving dist as built at http://localhost:");
		assert.ok(said.includes("note: preview works; ssqch calls it serve --built") && said.includes("Serving dist as built at http://localhost:") && !said.includes("Built in"), said);
	} finally {
		await server.stop();
	}
});

// A Sass file's partials beside it, outside the input folder, rebuild its CSS when they change.
test("serve_rebuilds_sass_when_a_partial_changes", async () => {
	const dir = tempDir("serve-sass-partial");
	write(dir, {
		"src/index.html": "<p>camp</p>",
		"styles/main.scss": "@use \"colors\";\nbody { color: colors.$pine; }\n",
		"styles/_colors.scss": "$pine: green;\n",
		"ssqch.config.js": "import { sassPlugin } from \"ssqch/sass\";\nexport default { dirs: { input: \"src\", output: \"dist\" }, plugins: [sassPlugin({ files: { \"styles/main.scss\": \"/app.css\" } })] };\n",
	});
	const logDir = tempDir("serve-sass-partial-log");
	const server = start(["serve", "--port", "0", "--root", dir], { logFile: path.join(logDir, "serve.log") });
	try {
		await waitFor(path.join(dir, "dist/app.css"), "green");
		// Written again each second: the server may not be watching yet on a busy machine.
		await changeAndWait(path.join(dir, "styles/_colors.scss"), "$pine: orange;\n", path.join(dir, "dist/app.css"), "orange");
	} finally {
		await server.stop();
	}
});

// a11y #20 and the known gaps: the dev server listened on 127.0.0.1 only, so a site couldn't be
// looked at on a phone. DELIBERATE (0.13.5): `--host 0.0.0.0` listens on every network and says
// where, with a word that anyone on it can see the site; the default is still this machine only.
test("serve_listens_on_the_network_with_host", async () => {
	const dir = tempDir("serve-host");
	write(dir, { "ssqch.config.js": "export default {};\n", "index.md": "Camp\n" });
	const ready = path.join(tempDir("serve-host-ready"), "ready.json");
	const log = path.join(tempDir("serve-host-log"), "serve.log");
	const server = start(["serve", "--port", "0", "--host", "0.0.0.0", "--ready-file", ready, "--root", dir], { logFile: log });
	try {
		await waitFor(ready, READY);
		const { url, port } = JSON.parse(fs.readFileSync(ready, "utf8"));
		assert.equal(url, `http://localhost:${port}/`);
		const said = await until(() => readOr(log).includes("Squatch Watch is on.") && readOr(log), () => readOr(log));
		const network = /\nOn your network: (http:\/\/[\d.]+:\d+\/)[^\n]* \(anyone on it can see the site\)\n/.exec(said);
		if (network) {
			// The address a phone would open answers.
			assert.equal((await fetch(network[1])).status, 200, network[1]);
		} else {
			assert.ok(said.includes("\nOn your network: no network address found (is this machine on one?)\n"), said);
		}
	} finally {
		await server.stop();
	}
	// An address that isn't one is refused before anything starts.
	const r = ssqch(["serve", "--host", "camp", "--root", dir]);
	assert.ok(!r.ok && r.log.includes("error: invalid value 'camp' for '--host <ADDRESS>': \"camp\" isn't an IP address: use 0.0.0.0"), r.log);
});
