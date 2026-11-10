// `ssqch/sass`: Sass to CSS, with grass (no Dart Sass or Node needed).
//
//   import { sassPlugin } from "ssqch/sass";
//
//   export default defineConfig({
//     plugins: [sassPlugin({ files: { "src/scss": "/css" } })],
//   });
//
// `files` maps sources (relative to the project root) to output URL paths: a
// folder compiles every .scss and .sass file in it not starting with `_`, a
// file compiles to the path given. Options: `style` ("compressed" or
// "expanded"; compressed for production builds by default) and `loadPaths`.
export function sassPlugin( options = {} ) {
	return { name: "ssqch/sass", builtin: "ssqch/sass", options };
}
