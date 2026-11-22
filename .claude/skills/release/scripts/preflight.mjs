#!/usr/bin/env node
// What the release workflow refuses a tag for (`plan` in .github/workflows/release.yml), and what a
// release commit tends to forget, checked before the commit is pushed: the places the version
// lives, the changelog's section, the docs' pinned versions, the "Not released yet" notes and the
// site's changelog entry.
//
//   node .claude/skills/release/scripts/preflight.mjs [version]
//
// The version is packages/ssqch/package.json's unless one is given. Exits with 1 when something
// needs fixing. It changes nothing.
import fs from "node:fs";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";

const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim();
const root = git("rev-parse", "--show-toplevel");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

const packageVersion = JSON.parse(read("packages/ssqch/package.json")).version;
const version = process.argv[2] ?? packageVersion;
const [major, minor, patch] = version.split(/[.-]/);

let failed = 0;
function check(ok, name, fix) {
	if (ok) console.log(`ok    ${name}`);
	else {
		failed++;
		console.log(`FIX   ${name}\n      ${fix}`);
	}
}
const note = (text) => console.log(`note  ${text}`);

console.log(`Release ${version}\n`);

// The places the version lives.
check(!version.includes("-dev"), "not a development version", `${version} is a development version: set the release's version first.`);
check(packageVersion === version, "packages/ssqch/package.json", `Its version is ${packageVersion}: set it to ${version}.`);
const lock = JSON.parse(read("packages/ssqch/package-lock.json"));
check(lock.version === version && lock.packages?.[""]?.version === version, "packages/ssqch/package-lock.json", `It has ${lock.version}: run \`npm install\` in packages/ssqch/.`);
const cargo = /\[workspace\.package\][^[]*?^version = "([^"]+)"/ms.exec(read("Cargo.toml"))?.[1];
check(cargo === version, "Cargo.toml (the workspace's version)", `It's ${cargo}: set it to ${version}.`);
const cargoLock = /name = "ssqch-plugin"\nversion = "([^"]+)"/.exec(read("Cargo.lock"))?.[1];
check(cargoLock === version, "Cargo.lock (ssqch-plugin)", `It has ${cargoLock}: run \`cargo update --workspace\`.`);

// CHANGELOG.md: the release's section, which becomes the GitHub release's notes.
const changelog = read("CHANGELOG.md");
const heading = new RegExp(`^## ${version.replaceAll(".", "\\.")} - (\\d{4}-\\d{2}-\\d{2})$`, "m").exec(changelog);
check(heading !== null, "CHANGELOG.md has the release's section", `Rename "## Unreleased" to "## ${version} - ${new Date().toISOString().slice(0, 10)}".`);
if (heading) {
	const after = changelog.slice(heading.index + heading[0].length);
	const section = after.slice(0, Math.max(0, after.search(/^## /m)));
	check(section.trim() !== "", "its section says something", "The section is empty: there's nothing to release.");
	const today = new Date().toISOString().slice(0, 10);
	if (heading[1] !== today) note(`the section's date is ${heading[1]}, and today (UTC) is ${today}`);
	if (/^### Breaking$/m.test(section) && patch !== "0") note(`the section has "### Breaking" and ${version} is a patch release: while 0.x, a breaking change bumps the minor version`);
}
check(!/^## Unreleased\s*$/m.test(changelog), 'no "## Unreleased" heading is left', "It's renamed to the release's heading, not kept beside it.");

// The docs' pinned versions.
const pins = [];
for (const file of git("ls-files", "site/src/docs").split("\n").filter((f) => f.endsWith(".md"))) {
	for (const [i, line] of read(file).split("\n").entries()) {
		for (const m of line.matchAll(/ssqch@(\d+\.\d+\.\d+[\w.-]*)|SSQCH_VERSION\s*=\s*"([^"]+)"/g)) {
			const pinned = m[1] ?? m[2];
			if (pinned !== version) pins.push(`${file}:${i + 1} has ${pinned}`);
		}
	}
}
check(pins.length === 0, "the docs' pinned versions", `${pins.join("\n      ")}\n      Set each to ${version}, unless it names an older release on purpose.`);

// The "Not released yet" notes: the workflow runs the same check on a tag.
const notes = spawnSync(process.execPath, ["scripts/unreleased-notes.mjs", "--check"], { cwd: root, encoding: "utf8" });
check(notes.status === 0, 'no "Not released yet" notes in the docs', `${(notes.stdout + notes.stderr).trim().split("\n").join("\n      ")}`);

// The site's changelog, for people: one entry for each minor release.
const entries = fs.readdirSync(path.join(root, "site/src/changelog")).filter((f) => f.endsWith(".md"));
const entry = entries.find((f) => new RegExp(`^releases: \\[[^\\]]*\\b${version.replaceAll(".", "\\.")}\\b`, "m").test(read(`site/src/changelog/${f}`)) || new RegExp(`^release: ${version.replaceAll(".", "\\.")}$`, "m").test(read(`site/src/changelog/${f}`)));
check(entry !== undefined, "the site's changelog has the release", patch === "0" ? `Write site/src/changelog/${major}.${minor}.md (the \`write\` skill, for the owner to edit).` : `In site/src/changelog/${major}.${minor}.md, add ${version} to \`releases\`, set \`lastRelease\` and \`lastDate\`, and add "## And in ${version}".`);
if (entry && patch !== "0") {
	const text = read(`site/src/changelog/${entry}`);
	check(new RegExp(`^lastRelease: ${version.replaceAll(".", "\\.")}$`, "m").test(text), `${entry}: lastRelease`, `Set \`lastRelease: ${version}\` and \`lastDate\`.`);
	check(text.includes(`## And in ${version}`), `${entry}: a paragraph about ${version}`, `Add "## And in ${version}" and a dated paragraph.`);
}

// What can't be fixed in the commit, for the person reading.
if (git("tag", "-l", `v${version}`) !== "") note(`the tag v${version} is already there`);
const dirty = git("status", "--porcelain");
if (dirty !== "") note(`the tree has uncommitted changes:\n      ${dirty.split("\n").join("\n      ")}`);
note(`on ${git("rev-parse", "--abbrev-ref", "HEAD")} at ${git("rev-parse", "--short", "HEAD")}`);

console.log(failed === 0 ? `\nReady: nothing here stops ${version}. (CI and the site's tests are separate.)` : `\n${failed} to fix before ${version} is tagged.`);
process.exit(failed === 0 ? 0 : 1);
