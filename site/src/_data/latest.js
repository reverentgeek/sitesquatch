// The latest release is the package's version: "Releasing" in AGENTS.md sets it in the release
// commit, so on main it's the version on npm (or the one about to be).
import { readFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync(new URL("../../../packages/ssqch/package.json", import.meta.url), "utf8"));

export default { version: pkg.version, node: pkg.engines?.node?.replace(/^>=\s*/, "") };
