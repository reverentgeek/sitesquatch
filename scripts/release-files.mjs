#!/usr/bin/env node
// Writes the files a release carries besides the npm tarball, from the tarball itself:
//
//   node scripts/release-files.mjs --version 0.8.0 --tarball <ssqch-0.8.0.tgz> --out <dir>
//
// - ssqch.rb: the Homebrew formula for reverentgeek/homebrew-tap (the release workflow commits
//   it as Formula/ssqch.rb). It installs the npm package with Homebrew's Node, from the
//   registry's URL for this version, with the tarball's SHA-256: `npm publish` uploads the
//   tarball as it is, so the registry serves these very bytes;
// - sha256.sum: the tarball's SHA-256, in the format `sha256sum -c` reads.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";

const REPO = "reverentgeek/sitesquatch";
const { values } = parseArgs({ options: { version: { type: "string" }, tarball: { type: "string" }, out: { type: "string" } } });
if (!values.version || !values.tarball || !values.out) {
	console.error("usage: node scripts/release-files.mjs --version <version> --tarball <ssqch-<version>.tgz> --out <dir>");
	process.exit(2);
}
const version = values.version.replace(/^v/, "");
const tarball = path.resolve(values.tarball);
const out = path.resolve(values.out);
if (!fs.existsSync(tarball)) throw new Error(`release-files: ${tarball} isn't there`);
if (path.basename(tarball) !== `ssqch-${version}.tgz`) throw new Error(`release-files: ${path.basename(tarball)} isn't ssqch-${version}.tgz`);
fs.mkdirSync(out, { recursive: true });

const sha256 = crypto.createHash("sha256").update(fs.readFileSync(tarball)).digest("hex");

// Homebrew's pattern for an npm package: its Node, `npm install` into libexec with
// `std_npm_args`, and a link to the command in bin. The version comes from the URL. The test
// builds a page with ssqch's own Markdown (a .wasm file), not only `--version`.
fs.writeFileSync(path.join(out, "ssqch.rb"), `# Written by ${REPO}'s release workflow (scripts/release-files.mjs) for ${version}.
class Ssqch < Formula
  desc "Fast, pluggable static site generator, configured with JavaScript"
  homepage "https://github.com/${REPO}"
  url "https://registry.npmjs.org/ssqch/-/ssqch-${version}.tgz"
  sha256 "${sha256}"
  license "MIT"

  depends_on "node"

  def install
    system "npm", "install", *std_npm_args
    bin.install_symlink libexec.glob("bin/*")
  end

  test do
    assert_match "ssqch #{version}", shell_output("#{bin}/ssqch --version")
    (testpath/"index.md").write "# Fresh tracks\\n"
    system bin/"ssqch", "build"
    assert_match "Fresh tracks", (testpath/"_site/index.html").read
  end
end
`);

fs.writeFileSync(path.join(out, "sha256.sum"), `${sha256}  ${path.basename(tarball)}\n`);
console.log(`Wrote ssqch.rb and sha256.sum in ${out} for ${version}`);
