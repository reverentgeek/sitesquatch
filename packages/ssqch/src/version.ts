// The version of ssqch that's running: the package's own.
import fs from "node:fs";

export const VERSION: string = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8")).version;
