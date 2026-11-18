// The npm face of a Rust plugin: a function that takes the site's options and returns what ssqch
// loads. ssqch reads `rust`; the plugin's hooks (its filters' names, its engines' extensions)
// come from the .wasm file's own manifest, so the package doesn't repeat them.
//
//   // ssqch.config.js
//   import trailGuide from "ssqch-plugin-trail-guide";
//   export default {
//     templateFormats: ["jinja", "md", "trail"],
//     plugins: [trailGuide({ greeting: "Howdy" })],
//   };
import { fileURLToPath } from "node:url";

/**
 * @param {import("./index.d.ts").TrailGuideOptions} [options]
 * @returns {import("./index.d.ts").RustPlugin}
 */
export default function trailGuide(options = {}) {
	return {
		name: "trail-guide",
		// fileURLToPath, not `.pathname`: that breaks on Windows and on paths with spaces.
		rust: { wasm: fileURLToPath(new URL("./trail_guide.wasm", import.meta.url)), options },
	};
}
