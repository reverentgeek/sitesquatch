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
		".gitignore": "_site\n.cache\n",
		"build.mjs": "import fs from \"node:fs\";\nfs.mkdirSync(\"_site/trail\", { recursive: true });\nfs.writeFileSync(\"_site/trail/index.html\", `<p>${fs.statSync(\"src/pine.md\").mtime.toISOString()} ${process.env.TZ} ${process.env.SOURCE_DATE_EPOCH}</p>`);\nfs.writeFileSync(\"_site/index.html\", `<p>${process.argv[2] === \"steady\" ? \"steady\" : Math.random()}</p>`);\n",
	});
	git(dir, "init", "-q");
	git(dir, "add", "-A");
	git(dir, "commit", "-q", "-m", "The old site");
	let r = ssqch(["baseline", "node build.mjs"], { cwd: dir });
	assert.equal(r.code, 1, r.log);
	// DELIBERATE (0.11, from the fresh opensource.guide move): the builds go under .cache, where
	// neither generator reads them as pages, and the message says what isn't pinned.
	const ref = ".cache/ssqch/baseline/ref";
	assert.ok(r.log.includes(`Base camp is set: ${ref}-1, ${ref}-2 and ${ref}-3, built from the working tree with TZ=UTC, SOURCE_DATE_EPOCH and every file's time pinned; a generator that reads its own clock isn't, so pin it in its config if the builds vary.`), r.log);
	// The build to compare with is the one most like the others (all three differ here: the first).
	assert.ok(r.log.includes("The build most like the others: .cache/ssqch/baseline/ref-1, with the most common version of 1 of the 1 file that vary.\n1 file has no most common version: each build has its own. More builds (--runs 20) show whether one is usual.\n"), r.log);
	// What varies is put together from each file's most common version, and compared with.
	assert.ok(r.log.includes("Wrote .cache/ssqch/baseline/ref-common: each file's most common version of the 3 builds"), r.log);
	assert.ok(exists(dir, ".cache/ssqch/baseline/ref-common/index.html") && exists(dir, ".cache/ssqch/baseline/ref-common/trail/index.html"));
	assert.ok(r.log.includes("Varies (1)\n  ~ /  (") && r.log.includes(`Next: build with ssqch into an empty folder, then \`ssqch diff ${ref}-common <ssqch's output>\`, with an --ignore for what varies above, and fix the biggest group first. The whole loop: \`ssqch docs "moving a site with an agent"\`.`), r.log);
	// Every file's time is the commit's, in every copy, and the clock is UTC.
	assert.equal(read(dir, `${ref}-2/trail/index.html`), "<p>2026-03-01T12:00:00.000Z UTC 1772366400</p>");
	assert.ok(!exists(dir, ".cache/ssqch/baseline-copies"), "the copies are removed");

	// A file git doesn't track goes into the copies, as the old generator reads the working tree, and
	// that's said. (Added in 0.11, from the fresh opensource.guide rerun: notes in the reference build.)
	write(dir, { "notes/today.md": "notes" });
	r = ssqch(["baseline", "node build.mjs steady", "--runs", "1", "--quiet"], { cwd: dir });
	assert.ok(r.ok && r.log.includes("warn: 1 file git doesn't track goes into the copies too (notes/), as the old generator reads the working tree"), r.log);
	fs.rmSync(path.join(dir, "notes"), { recursive: true });

	// Two builds of a steady command agree, and a third left from before is removed.
	r = ssqch(["baseline", "node build.mjs steady", "--runs", "2", "--quiet"], { cwd: dir });
	assert.equal(r.code, 0, r.log);
	assert.ok(r.log.includes("Every build is the same: 2 pages and 0 other files."), r.log);
	assert.ok(!exists(dir, ".cache/ssqch/baseline/ref-common"), "an earlier run's is removed");
	assert.ok(!exists(dir, `${ref}-3`));

	// --commit builds that commit, in a worktree it removes afterwards.
	fs.writeFileSync(path.join(dir, "build.mjs"), "process.exit(1);\n");
	// And --to names a folder that isn't there yet.
	r = ssqch(["baseline", "node build.mjs steady", "--runs", "1", "--commit", "HEAD", "--to", ".refs/old", "--quiet"], { cwd: dir });
	assert.equal(r.code, 0, r.log);
	assert.ok(exists(dir, ".refs/old-1/index.html"));
	assert.equal(git(dir, "worktree", "list").split("\n").length, 1);

	// --patch applies a fix to each copy first: here, to the commit whose build fails. (Added in
	// 0.11, from the fresh a11yproject.com rerun: a commit that needed a fix couldn't be built.)
	git(dir, "add", "-A");
	git(dir, "commit", "-q", "-m", "Break the build");
	fs.writeFileSync(path.join(dir, "fix.patch"), git(dir, "diff", "HEAD", "HEAD~1", "--", "build.mjs") + "\n");
	r = ssqch(["baseline", "node build.mjs steady", "--runs", "1", "--commit", "HEAD", "--patch", "fix.patch"], { cwd: dir });
	assert.equal(r.code, 0, r.log);
	assert.ok(r.log.includes("Base camp is set: .cache/ssqch/baseline/ref-1, built from HEAD and fix.patch with TZ=UTC"), r.log);
	r = ssqch(["baseline", "node build.mjs steady", "--runs", "1", "--patch", "nope.patch", "--quiet"], { cwd: dir });
	assert.ok(r.code === 2 && r.log.includes("--patch nope.patch: no such file"), r.log);
	// The commit before has the fix already.
	r = ssqch(["baseline", "node build.mjs steady", "--runs", "1", "--commit", "HEAD~1", "--patch", "fix.patch", "--quiet"], { cwd: dir });
	assert.ok(r.code === 2 && r.log.includes("--patch fix.patch: didn't apply to HEAD~1: "), r.log);
	assert.equal(git(dir, "worktree", "list").split("\n").length, 1);
	fs.rmSync(path.join(dir, "fix.patch"));

	// What goes wrong says so, and exits 2.
	r = ssqch(["baseline", "node build.mjs", "--quiet"], { cwd: dir });
	assert.ok(r.code === 2 && r.log.includes("`node build.mjs` failed in build 1 (exit code 1); its output is above"), r.log);
	r = ssqch(["baseline", "node -e 0", "--from", "out", "--quiet"], { cwd: dir });
	assert.ok(r.code === 2 && r.log.includes("`node -e 0` wrote no out/ in build 1: give the folder it writes with --from"), r.log);
	r = ssqch(["baseline", "node -e 0", "--commit", "nope", "--quiet"], { cwd: dir });
	assert.ok(r.code === 2 && r.log.includes("--commit nope: no such commit"), r.log);
	r = ssqch(["baseline", "node -e 0", "--to", "../out", "--quiet"], { cwd: dir });
	assert.ok(r.code === 2 && r.log.includes("--to ../out: a name inside the site's folder"), r.log);
});

// Jekyll prints site.time and doesn't read SOURCE_DATE_EPOCH (the fresh opensource.guide move:
// 380 files varied): `jekyll build` gets a config of its own that pins `time:`, unless the
// command gives its configs.
test("baseline_pins_jekylls_own_clock", { skip: (!hasGit && "needs git") || (process.platform === "win32" && "a script called as ./jekyll") }, () => {
	const dir = tempDir("baseline-jekyll");
	write(dir, {
		"_config.yml": "title: Trail\n",
		".gitignore": "_site\n",
		// A stand-in for Jekyll: writes the --config it was given.
		"jekyll": "#!/usr/bin/env node\nconst fs = require(\"node:fs\");\nconst i = process.argv.indexOf(\"--config\");\nconst files = i < 0 ? [] : process.argv[i + 1].split(\",\");\nfs.mkdirSync(\"_site\", { recursive: true });\nfs.writeFileSync(\"_site/index.html\", files.map((f) => f === \"_config.yml\" ? f : fs.readFileSync(f, \"utf8\").split(\"\\n\")[1]).join(\" | \"));\n",
	});
	fs.chmodSync(path.join(dir, "jekyll"), 0o755);
	git(dir, "init", "-q");
	git(dir, "add", "-A");
	git(dir, "commit", "-q", "-m", "The old site");
	let r = ssqch(["baseline", "./jekyll build", "--runs", "1"], { cwd: dir });
	assert.equal(r.code, 0, r.log);
	assert.ok(r.log.includes("Jekyll's site.time pinned (with --config _config.yml and a time: of its own)"), r.log);
	assert.equal(read(dir, ".cache/ssqch/baseline/ref-1/index.html"), "_config.yml | time: 2026-03-01 12:00:00 +0000");
	r = ssqch(["baseline", "./jekyll build --config _config.yml", "--runs", "1", "--quiet"], { cwd: dir });
	assert.equal(read(dir, ".cache/ssqch/baseline/ref-1/index.html"), "_config.yml");
});

// opensource.guide's Jekyll wouldn't start in a copy: its gems are in `vendor/gems`, which
// `.bundle/config` names and git ignores. The installs a site has are linked into each copy,
// and `--link` adds others.
test("baseline_links_the_sites_installs_into_each_copy", { skip: !hasGit && "needs git" }, () => {
	const dir = tempDir("baseline-links");
	write(dir, {
		".gitignore": "_site\n.cache\n.bundle\n/vendor\ntools\n",
		".bundle/config": "---\nBUNDLE_PATH: \"vendor/gems\"\n",
		"vendor/gems/jekyll.txt": "gems",
		"tools/helper.txt": "help",
		"build.mjs": "import fs from \"node:fs\";\nfs.mkdirSync(\"_site\", { recursive: true });\nfs.writeFileSync(\"_site/index.html\", [\".bundle/config\", \"vendor/gems/jekyll.txt\", \"tools/helper.txt\"].map((f) => fs.existsSync(f) ? \"yes\" : \"no\").join(\" \"));\n",
	});
	git(dir, "init", "-q");
	git(dir, "add", "-A");
	git(dir, "commit", "-q", "-m", "The old site");
	let r = ssqch(["baseline", "node build.mjs", "--runs", "1", "--quiet"], { cwd: dir });
	assert.equal(r.code, 0, r.log);
	assert.equal(read(dir, ".cache/ssqch/baseline/ref-1/index.html"), "yes yes no");
	r = ssqch(["baseline", "node build.mjs", "--runs", "1", "--link", "tools", "--quiet"], { cwd: dir });
	assert.equal(r.code, 0, r.log);
	assert.equal(read(dir, ".cache/ssqch/baseline/ref-1/index.html"), "yes yes yes");
	r = ssqch(["baseline", "node build.mjs", "--link", "../elsewhere", "--quiet"], { cwd: dir });
	assert.ok(r.code === 2 && r.log.includes("--link ../elsewhere: a folder inside the site's folder"), r.log);
});
