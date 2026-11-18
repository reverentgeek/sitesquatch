// What browsers hear from the dev server (crates/sitesquatch/src/serve.rs).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { Live, missingMessage } from "./live.ts";

function tempDir(name: string): string {
	return fs.mkdtempSync(path.join(os.tmpdir(), `ssqch-${name}-`));
}

test("browsers_hear_what_changed", async () => {
	const dir = tempDir("serve-live");
	const write = (rel: string, text: string) => {
		fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
		fs.writeFileSync(path.join(dir, rel), text);
	};
	try {
		write("index.html", "home");
		write("about/index.html", "about");
		write("assets/index.css", "body{}");
		write("assets/index.js", "1");
		write("feed.xml", "<feed/>");
		const live = new Live(0);
		await live.changed(dir);
		const answer = (since: number | undefined, page: string) => JSON.stringify(live.answer(since, page, "/repo"));
		// A browser that has just arrived only learns where things stand.
		assert.equal(answer(undefined, "index.html"), "{\"id\":1,\"error\":null,\"reload\":false,\"css\":[]}");
		assert.equal(answer(1, "index.html"), "{\"id\":1,\"error\":null,\"reload\":false,\"css\":[]}");

		// Another page (and the feed) changed: this one stays. Its own page reloads.
		write("about/index.html", "about us");
		write("feed.xml", "<feed>more</feed>");
		await live.changed(dir);
		assert.equal(answer(1, "index.html"), "{\"id\":2,\"error\":null,\"reload\":false,\"css\":[]}");
		assert.equal(answer(1, "about/index.html"), "{\"id\":2,\"error\":null,\"reload\":true,\"css\":[]}");
		// A page that isn't there yet reloads, in case it is now.
		assert.equal(answer(1, "contact/index.html"), "{\"id\":2,\"error\":null,\"reload\":true,\"css\":[]}");

		// A stylesheet is swapped, under the site's base; a script reloads.
		write("assets/index.css", "body{color:red}");
		await live.changed(dir);
		assert.equal(answer(2, "index.html"), "{\"id\":3,\"error\":null,\"reload\":false,\"css\":[\"/repo/assets/index.css\"]}");
		// A browser that missed a build hears about both.
		assert.equal(answer(1, "about/index.html"), "{\"id\":3,\"error\":null,\"reload\":true,\"css\":[\"/repo/assets/index.css\"]}");
		write("assets/index.js", "22");
		await live.changed(dir);
		assert.equal(answer(3, "index.html"), "{\"id\":4,\"error\":null,\"reload\":true,\"css\":[]}");

		// A failed build changes nothing but says so, until one works.
		live.failed("in index.md: nope");
		assert.equal(answer(4, "index.html"), "{\"id\":5,\"error\":\"in index.md: nope\",\"reload\":false,\"css\":[]}");
		await live.changed(dir);
		assert.equal(answer(5, "index.html"), "{\"id\":6,\"error\":null,\"reload\":false,\"css\":[]}");
		// A page that went away, and a server that started again.
		fs.rmSync(path.join(dir, "about/index.html"));
		await live.changed(dir);
		assert.equal(answer(6, "about/index.html"), "{\"id\":7,\"error\":null,\"reload\":true,\"css\":[]}");
		assert.equal(answer(40, "index.html"), "{\"id\":7,\"error\":null,\"reload\":true,\"css\":[]}");

		// A stylesheet a tool empties and then writes (as PostCSS does) is heard about once it's
		// written: browsers don't fetch it empty. Looking again with nothing new says nothing.
		write("assets/index.css", "");
		const writer = sleep(150).then(() => write("assets/index.css", "body{color:green}"));
		assert.deepEqual(await live.changed(dir), ["assets/index.css"]);
		await writer;
		assert.equal(live.sizeSeen("assets/index.css"), 17);
		assert.deepEqual(await live.changed(dir), []);
		assert.equal(answer(7, "index.html"), "{\"id\":8,\"error\":null,\"reload\":false,\"css\":[\"/repo/assets/index.css\"]}");
	} finally {
		fs.rmSync(dir, { recursive: true, force: true });
	}
});

test("a_browser_from_an_earlier_server_reloads_once_this_one_builds", async () => {
	const dir = tempDir("serve-restart");
	try {
		fs.writeFileSync(path.join(dir, "index.html"), "home");
		// The earlier server had made one update; so has this one.
		const earlier = new Live();
		await earlier.changed(dir);
		const seen = earlier.answer(undefined, "index.html", "").id;
		await sleep(5);
		const live = new Live();
		// Before the first build is told (it waits for the tools), nothing to do yet.
		assert.equal(live.answer(seen, "index.html", "").reload, false);
		await live.changed(dir);
		assert.equal(live.answer(seen, "index.html", "").reload, true);
		const now = live.answer(undefined, "index.html", "").id;
		assert.equal(live.answer(now, "index.html", "").reload, false);
	} finally {
		fs.rmSync(dir, { recursive: true, force: true });
	}
});

test("a_missing_file_names_who_could_have_written_it", () => {
	assert.equal(missingMessage("/app.css", [], "dist"), "/app.css is linked but nothing wrote it to dist. If a tool makes it, run its watcher with `serve.run` (see \"CSS and JavaScript\" in the README)");
	assert.equal(missingMessage("/app.css", ["postcss"], "dist"), "/app.css is linked but isn't in dist: serve.run's postcss hasn't written it (its output is in the terminal)");
	assert.equal(missingMessage("/app.css", ["postcss", "esbuild", "tsc"], "dist"), "/app.css is linked but isn't in dist: none of serve.run's postcss, esbuild or tsc has written it (their output is in the terminal)");
});
