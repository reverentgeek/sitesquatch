// Watching folders, both ways: one watcher for a tree (macOS and Windows), and one for each
// folder (Linux). Both run on every system, so each is tested wherever the tests run.
import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { realPath } from "../paths.ts";
import { Channel, POLL_MS, Watcher, chooseStrategy, defaultStrategy } from "./watch.ts";
import type { Strategy } from "./watch.ts";

function tempDir(name: string): string {
	return realPath(fs.mkdtempSync(path.join(os.tmpdir(), `ssqch-${name}-`)));
}

/** Removes a test's folder. On Windows a process that's ending can hold a file a moment longer: tried again, then left for the system to clear. */
function remove(dir: string): void {
	try { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }); } catch { /* left in the temporary folder */ }
}

async function until(found: () => boolean, what: () => string): Promise<void> {
	const started = Date.now();
	while (!found()) {
		assert.ok(Date.now() - started < 10_000, what());
		await sleep(20);
	}
}

for (const strategy of ["tree", "folders", "poll"] as Strategy[]) {
	test(`changes below a watched folder are seen (${strategy})`, async () => {
		const dir = tempDir(`watch-${strategy}`);
		const write = (rel: string, text: string) => {
			fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
			fs.writeFileSync(path.join(dir, rel), text);
		};
		write("src/posts/a.md", "a");
		write("src/node_modules/pkg/index.js", "1");
		write("beside.md", "not watched");
		const seen = new Set<string>();
		const watcher = new Watcher((file) => seen.add(file), strategy);
		try {
			watcher.watch(path.join(dir, "src"), true);
			if (strategy === "folders") assert.equal(watcher.size, 2, "src and src/posts, and not node_modules");
			// A watch that has just begun can still report what was written before it.
			await sleep(200);
			seen.clear();
			const has = (rel: string) => () => seen.has(path.join(dir, rel));
			const said = () => JSON.stringify([...seen]);

			write("src/posts/a.md", "changed");
			await until(has("src/posts/a.md"), said);
			// A folder made later is watched too, and what's put in it at once isn't missed.
			write("src/trails/cedar/b.md", "b");
			await until(has("src/trails/cedar/b.md"), said);
			await sleep(100);
			seen.clear();
			write("src/trails/cedar/b.md", "changed");
			await until(has("src/trails/cedar/b.md"), said);
			// A file that goes is a change.
			seen.clear();
			fs.rmSync(path.join(dir, "src/posts/a.md"));
			await until(has("src/posts/a.md"), said);
			// A folder that goes takes its watchers with it, and one made again is watched again.
			// (Not a watcher for each folder on Windows, which ssqch doesn't use there: a
			// watched folder is only gone once its watcher is, and can't be made again before.)
			if (!(process.platform === "win32" && strategy === "folders")) {
				fs.rmSync(path.join(dir, "src/trails"), { recursive: true });
				await sleep(200);
				seen.clear();
				write("src/trails/cedar/c.md", "c");
				await until(has("src/trails/cedar/c.md"), said);
			}
			assert.ok(![...seen].some((file) => file.endsWith("beside.md")), said());
		} finally {
			watcher.close();
			remove(dir);
		}
		assert.equal(watcher.size, 0);
	});

	test(`a folder's own files are seen without what's below it (${strategy})`, async () => {
		const dir = tempDir(`watch-flat-${strategy}`);
		fs.mkdirSync(path.join(dir, "lib/deep"), { recursive: true });
		fs.writeFileSync(path.join(dir, "ssqch.config.js"), "1");
		const seen = new Set<string>();
		const watcher = new Watcher((file) => seen.add(file), strategy);
		try {
			watcher.watch(dir, false);
			await sleep(200);
			seen.clear();
			// Saved the way editors save: a new file put in the old one's place.
			fs.writeFileSync(path.join(dir, "ssqch.config.js.tmp"), "2");
			fs.renameSync(path.join(dir, "ssqch.config.js.tmp"), path.join(dir, "ssqch.config.js"));
			await until(() => seen.has(path.join(dir, "ssqch.config.js")), () => JSON.stringify([...seen]));
			fs.writeFileSync(path.join(dir, "lib/deep/x.js"), "1");
			await sleep(300);
			assert.ok(!seen.has(path.join(dir, "lib/deep/x.js")), JSON.stringify([...seen]));
			// Asking for the same folder again changes nothing; asking for all of it does.
			watcher.watch(dir, false);
			assert.equal(watcher.size, 1);
			watcher.watch(dir, true);
			await sleep(200);
			fs.writeFileSync(path.join(dir, "lib/deep/x.js"), "2");
			await until(() => seen.has(path.join(dir, "lib/deep/x.js")), () => JSON.stringify([...seen]));
		} finally {
			watcher.close();
			remove(dir);
		}
	});
}

test("deleting a tree of thousands of watched folders takes time in step with it (folders)", (t) => {
	// The system's own watchers stand aside, so what's timed is the watcher's own bookkeeping:
	// closing thousands of real ones costs what the system makes it cost (on macOS, where this
	// strategy isn't used, more than everything else here).
	const fake = new Map<string, { listener: (event: string, name: string) => void; closed: boolean }>();
	t.mock.method(fs, "watch", (dir: string, _options: unknown, listener: (event: string, name: string) => void) => {
		const watcher = Object.assign(new EventEmitter(), { close() { fake.get(dir)!.closed = true; } });
		fake.set(dir, { listener, closed: false });
		return watcher;
	});
	const dir = tempDir("watch-many");
	const posts = path.join(dir, "_site", "posts");
	const n = 3000;
	for (let i = 0; i < n; i++) {
		fs.mkdirSync(path.join(posts, `p${i}`), { recursive: true });
		fs.writeFileSync(path.join(posts, `p${i}`, "index.html"), "<h1>Pine Cone Crunch</h1>");
	}
	let seen = 0;
	const watcher = new Watcher(() => { seen++; }, "folders");
	try {
		watcher.watch(dir, true);
		assert.equal(watcher.size, n + 3);
		fs.rmSync(path.join(dir, "_site"), { recursive: true });
		// What inotify says as `rm -rf` goes: each page's file, then its folder, to the folder it was in.
		const started = performance.now();
		const fire = (folder: string, name: string) => fake.get(folder)!.listener("rename", name);
		for (let i = 0; i < n; i++) {
			fire(path.join(posts, `p${i}`), "index.html");
			fire(posts, `p${i}`);
		}
		fire(path.join(dir, "_site"), "posts");
		fire(dir, "_site");
		const took = performance.now() - started;
		assert.equal(seen, 2 * n + 2);
		assert.equal(watcher.size, 1, "only the top is left");
		assert.equal([...fake.values()].filter((w) => !w.closed).length, 1);
		// It was minutes: every folder that went asked the file system about every one left.
		assert.ok(took < 3000, `${n} folders took ${Math.round(took)} ms`);
		// A folder made again under a name that's gone is watched again.
		fs.mkdirSync(path.join(posts, "p0"), { recursive: true });
		fire(dir, "_site");
		assert.equal(watcher.size, 4);
	} finally {
		watcher.close();
		remove(dir);
	}
});

test("a folder that isn't there can't be watched", () => {
	for (const strategy of ["tree", "folders", "poll"] as Strategy[]) {
		const watcher = new Watcher(() => {}, strategy);
		assert.throws(() => watcher.watch(path.join(os.tmpdir(), "ssqch-no-such-folder"), true));
		assert.equal(watcher.size, 0);
		watcher.close();
	}
});

test("a channel hands over what it's sent, in order", async () => {
	const rx = new Channel<number>();
	assert.equal(rx.tryRecv(), undefined);
	rx.send(1);
	rx.send(2);
	assert.equal(await rx.recv(), 1);
	assert.equal(await rx.recvTimeout(1000), 2);
	const started = performance.now();
	assert.equal(await rx.recvTimeout(60), undefined);
	assert.ok(performance.now() - started >= 50);
	setTimeout(() => rx.send(3), 20);
	assert.equal(await rx.recvTimeout(5000), 3);
	setTimeout(() => rx.send(4), 20);
	assert.equal(await rx.recv(), 4);
	rx.send(5);
	rx.drain();
	assert.equal(rx.tryRecv(), undefined);
});

// Where the system sends no events, the server built once and never again, without a word: a
// Windows drive under WSL, some Docker mounts, network shares. SSQCH_WATCH says, and a site on a
// Windows drive under WSL polls by itself.
test("polling is chosen by SSQCH_WATCH, and by itself for a Windows drive under WSL", () => {
	const linux = (env: NodeJS.ProcessEnv, paths = ["/home/ranger/site"], release = "6.6.0-generic") => chooseStrategy(paths, env, release, "linux");
	assert.deepEqual(linux({ SSQCH_WATCH: "poll" }), { strategy: "poll", why: "SSQCH_WATCH=poll" });
	assert.equal(linux({}).strategy, defaultStrategy());
	assert.equal(linux({}, ["/mnt/c/Users/ranger/site"]).strategy, defaultStrategy(), "a /mnt that isn't WSL's");
	const wsl = linux({ WSL_DISTRO_NAME: "Ubuntu" }, ["/mnt/c/Users/ranger/site"]);
	assert.equal(wsl.strategy, "poll");
	assert.match(wsl.why!, /Windows drive/);
	assert.equal(linux({}, ["/mnt/d/site"], "5.15.167.4-microsoft-standard-WSL2").strategy, "poll");
	assert.equal(linux({ WSL_DISTRO_NAME: "Ubuntu" }, ["/home/ranger/site"]).strategy, defaultStrategy(), "WSL's own disk sends events");
	assert.equal(linux({ WSL_DISTRO_NAME: "Ubuntu", SSQCH_WATCH: "events" }, ["/mnt/c/site"]).strategy, defaultStrategy());
	assert.equal(linux({ SSQCH_WATCH: "sometimes" }).unknown, "sometimes");
});

// A look at a big site takes a while, so the next waits four times as long as it took, and a
// watcher with nothing to poll doesn't keep looking.
test("polling waits at least its interval, and stops when it's closed", async () => {
	const dir = tempDir("watch-poll-timing");
	fs.writeFileSync(path.join(dir, "a.md"), "a");
	let seen = 0;
	const watcher = new Watcher(() => { seen++; }, "poll");
	try {
		watcher.watch(dir, true);
		assert.ok(watcher.pollEvery >= POLL_MS);
		await sleep(POLL_MS * 3);
		assert.equal(seen, 0, "nothing changed, nothing said");
		watcher.close();
		fs.writeFileSync(path.join(dir, "a.md"), "changed");
		await sleep(POLL_MS * 3);
		assert.equal(seen, 0, "closed");
	} finally {
		watcher.close();
		remove(dir);
	}
});
