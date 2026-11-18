#!/usr/bin/env node
// Writes the files a release carries besides its archives, from the archives themselves:
//
//   node scripts/release-files.mjs --version 0.8.0 --archives <dir> --out <dir>
//
// - ssqch-installer.sh and ssqch-installer.ps1: scripts/install.sh and install.ps1, with the
//   release's version in them, so download/v0.8.0/ssqch-installer.sh installs 0.8.0;
// - ssqch.rb: the Homebrew formula for reverentgeek/homebrew-tap, with each archive's URL and
//   SHA-256 (the release workflow commits it as Formula/ssqch.rb);
// - sha256.sum: every file's SHA-256, in the format `sha256sum -c` reads.
//
// <dir> holds the archives as the release workflow names them (ssqch-<target>.tar.gz, and .zip
// for Windows), and the npm tarball.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REPO = "reverentgeek/sitesquatch";
const { values } = parseArgs({ options: { version: { type: "string" }, archives: { type: "string" }, out: { type: "string" } } });
if (!values.version || !values.archives || !values.out) {
	console.error("usage: node scripts/release-files.mjs --version <version> --archives <dir> --out <dir>");
	process.exit(2);
}
const version = values.version.replace(/^v/, "");
const archives = path.resolve(values.archives);
const out = path.resolve(values.out);
fs.mkdirSync(out, { recursive: true });

const sha256 = (file) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const archive = (target) => {
	const name = `ssqch-${target}.${target.includes("windows") ? "zip" : "tar.gz"}`;
	const file = path.join(archives, name);
	if (!fs.existsSync(file)) throw new Error(`release-files: ${file} isn't there`);
	return { name, url: `https://github.com/${REPO}/releases/download/v${version}/${name}`, sha256: sha256(file) };
};

for (const [from, to] of [["install.sh", "ssqch-installer.sh"], ["install.ps1", "ssqch-installer.ps1"]]) {
	const text = fs.readFileSync(path.join(root, "scripts", from), "utf8");
	if (!text.includes("@SSQCH_VERSION@")) throw new Error(`release-files: scripts/${from} has no @SSQCH_VERSION@ to fill in`);
	fs.writeFileSync(path.join(out, to), text.replaceAll("@SSQCH_VERSION@", version));
}
fs.chmodSync(path.join(out, "ssqch-installer.sh"), 0o755);

const arm = archive("aarch64-apple-darwin");
const intel = archive("x86_64-apple-darwin");
const linux = archive("x86_64-unknown-linux-gnu");
archive("x86_64-pc-windows-msvc");
// The executable is Node with ssqch inside it, so the formula installs it as it is: no Node
// dependency, and nothing to build.
fs.writeFileSync(path.join(out, "ssqch.rb"), `# Written by reverentgeek/sitesquatch's release workflow (scripts/release-files.mjs) for ${version}.
class Ssqch < Formula
  desc "Fast static site generator, configured with JavaScript"
  homepage "https://github.com/${REPO}"
  version "${version}"
  license "MIT"

  on_macos do
    on_arm do
      url "${arm.url}"
      sha256 "${arm.sha256}"
    end
    on_intel do
      url "${intel.url}"
      sha256 "${intel.sha256}"
    end
  end

  on_linux do
    on_intel do
      url "${linux.url}"
      sha256 "${linux.sha256}"
    end
  end

  def install
    bin.install "ssqch"
  end

  test do
    assert_match "ssqch #{version}", shell_output("#{bin}/ssqch --version")
  end
end
`);

const listed = [...fs.readdirSync(archives).map((name) => path.join(archives, name)), ...["ssqch-installer.sh", "ssqch-installer.ps1"].map((name) => path.join(out, name))]
	.filter((file) => fs.statSync(file).isFile() && !file.endsWith(".sha256"))
	.sort((a, b) => path.basename(a).localeCompare(path.basename(b), "en"));
fs.writeFileSync(path.join(out, "sha256.sum"), listed.map((file) => `${sha256(file)}  ${path.basename(file)}\n`).join(""));
console.log(`Wrote ${["ssqch-installer.sh", "ssqch-installer.ps1", "ssqch.rb", "sha256.sum"].join(", ")} in ${out} for ${version}`);
