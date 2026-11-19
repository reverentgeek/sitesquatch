// Added in 0.11 (0.7 had no `ssqch baseline`). Every move built the old site from fresh copies with
// the clock pinned, a few times, to see what changed by itself (v8.dev's `scripts/parity.sh`,
// lit.dev's `stability.py`): `ssqch baseline "<command>"` does it for any generator.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { ssqch, tempDir, write, read, exists } from "../lib/ssqch.js";

const hasGit = spawnSync("git", ["--version"]).status === 0;
const git = (dir, ...args) => {
	const r = spawnSync("git", ["-C", dir, "-c", "user.email=ranger@example.com", "-c", "user.name=Ranger", ...args], { encoding: "utf8", env: { ...process.env, GIT_AUTHOR_DATE: "2026-03-01T12:00:00Z", GIT_COMMITTER_DATE: "2026-03-01T12:00:00Z" } });
	assert.equal(r.status, 0, r.stderr);
	return r.stdout.trim();
};

test("baseline_builds_the_old_site_and_says_what_varies", { skip: !hasGit && "needs git" }, () => {
	const dir = tempDir("baseline");
	// The "old generator": a page dated by its file's time and the time zone, and one that changes
	// each build.
	write(dir, {
		"src/pine.md": "# Pine\n",
		".gitignore": "_site\nref-*\n",
		"build.mjs": "import fs from \"node:fs\";\nfs.mkdirSync(\"_site/trail\", { recursive: true });\nfs.writeFileSync(\"_site/trail/index.html\", `<p>${fs.statSync(\"src/pine.md\").mtime.toISOString()} ${process.env.TZ} ${process.env.SOURCE_DATE_EPOCH}</p>`);\nfs.writeFileSync(\"_site/index.html\", `<p>${process.argv[2] === \"steady\" ? \"steady\" : Math.random()}</p>`);\n",
	});
	git(dir, "init", "-q");
	git(dir, "add", "-A");
	git(dir, "commit", "-q", "-m", "The old site");
	let r = ssqch(["baseline", "node build.mjs"], { cwd: dir });
	assert.equal(r.code, 1, r.log);
	assert.ok(r.log.includes("Base camp is set: ref-1, ref-2 and ref-3, built from the working tree with TZ=UTC and every file's time pinned."), r.log);
	assert.ok(r.log.includes("Varies (1)\n  ~ /  (") && r.log.includes("Next: build with ssqch into an empty folder, then `ssqch diff ref-1 <ssqch's output>`, with an --ignore for what varies above."), r.log);
	// Every file's time is the commit's, in every copy, and the clock is UTC.
	assert.equal(read(dir, "ref-2/trail/index.html"), "<p>2026-03-01T12:00:00.000Z UTC 1772366400</p>");
	assert.ok(!exists(dir, ".cache/ssqch/baseline"), "the copies are removed");

	// Two builds of a steady command agree, and a third left from before is removed.
	r = ssqch(["baseline", "node build.mjs steady", "--runs", "2", "--quiet"], { cwd: dir });
	assert.equal(r.code, 0, r.log);
	assert.ok(r.log.includes("Every build is the same: 2 pages and 0 other files."), r.log);
	assert.ok(!exists(dir, "ref-3"));

	// --commit builds that commit, in a worktree it removes afterwards.
	fs.writeFileSync(path.join(dir, "build.mjs"), "process.exit(1);\n");
	r = ssqch(["baseline", "node build.mjs steady", "--runs", "1", "--commit", "HEAD", "--to", "old", "--quiet"], { cwd: dir });
	assert.equal(r.code, 0, r.log);
	assert.ok(exists(dir, "old-1/index.html"));
	assert.equal(git(dir, "worktree", "list").split("\n").length, 1);

	// What goes wrong says so, and exits 2.
	r = ssqch(["baseline", "node build.mjs", "--quiet"], { cwd: dir });
	assert.ok(r.code === 2 && r.log.includes("`node build.mjs` failed in build 1 (exit code 1); its output is above"), r.log);
	r = ssqch(["baseline", "node -e 0", "--from", "out", "--quiet"], { cwd: dir });
	assert.ok(r.code === 2 && r.log.includes("`node -e 0` wrote no out/ in build 1: give the folder it writes with --from"), r.log);
	r = ssqch(["baseline", "node -e 0", "--commit", "nope", "--quiet"], { cwd: dir });
	assert.ok(r.code === 2 && r.log.includes("--commit nope: no such commit"), r.log);
});
