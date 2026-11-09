// `ssqch/assets`: asset fingerprinting.
//
//   import { assetsPlugin } from "ssqch/assets";
//
//   export default defineConfig({
//     plugins: [assetsPlugin({ files: ["/assets/index.css", "/assets/index.js"] })],
//   });
//
// Templates link the plain paths (`/assets/index.css`). In a production
// build, each file in the output folder is renamed to `name.<hash>.ext` and
// every href and src pointing at it is rewritten. `ssqch serve` leaves them
// alone. Options: `files` (URL paths, required) and `fingerprint` (true or
// false; production builds only by default). Templates can also call
// `assetUrl("/assets/index.css")` for the URL to use.
export function assetsPlugin( options = {} ) {
	return { name: "ssqch/assets", builtin: "ssqch/assets", options };
}
