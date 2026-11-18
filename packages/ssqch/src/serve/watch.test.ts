// Watching folders, both ways: one watcher for a tree (macOS and Windows), and one for each
// folder (Linux). Both run on every system, so each is tested wherever the tests run.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { realPath } from "../paths.ts";
import { Channel, Watcher } from "./watch.ts";
import type { Strategy } from "./watch.ts";

function tempDir(name: string): string {
	return realPath(fs.mkdtempSync(path.join(os.tmpdir(), `ssqch-${name}-`)));
}

async function until(found: () => boolean, what: () => string): Promise<void> {
	const started = Date.now();
	while (!found()) {
		assert.ok(Date.now() - started < 10_000, what());
		await sleep(20);
	}
}

for (const strategy of ["tree", "folders"] as Strategy[]) {
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
			fs.rmSync(path.join(dir, "src/trails"), { recursive: true });
			await sleep(200);
			seen.clear();
			write("src/trails/cedar/c.md", "c");
			await until(has("src/trails/cedar/c.md"), said);
			assert.ok(![...seen].some((file) => file.endsWith("beside.md")), said());
		} finally {
			watcher.close();
			fs.rmSync(dir, { recursive: true, force: true });
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
			fs.rmSync(dir, { recursive: true, force: true });
		}
	});
}

test("a folder that isn't there can't be watched", () => {
	for (const strategy of ["tree", "folders"] as Strategy[]) {
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
