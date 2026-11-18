// The names `serve.run`'s tools are shown under (crates/sitesquatch/src/companions.rs).
import { test } from "node:test";
import assert from "node:assert/strict";
import { toolName } from "./companions.ts";

test("a_command_is_named_after_its_tool", () => {
	for (const [command, name] of [
		["npx postcss src/assets/css/index.css -o dist/assets/index.css --watch", "postcss"],
		["npx @tailwindcss/cli -i src/app.css -o dist/app.css --watch", "tailwindcss"],
		["pnpm exec esbuild src/app.js --bundle --watch", "esbuild"],
		["node scripts/watch-icons.mjs", "watch-icons"],
		["NODE_ENV=development npx tsc --watch", "tsc"],
		["bunx sass@1.80 src/main.scss dist/main.css --watch", "sass"],
		["./bin/watch", "watch"],
		["npx --yes", "run"],
	]) {
		assert.equal(toolName(command), name, command);
	}
});
