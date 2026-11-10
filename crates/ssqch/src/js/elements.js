// `ssqch/elements`: custom elements whose scripts load only where they're used.
//
//   import { elementsPlugin } from "ssqch/elements";
//
//   export default defineConfig({ plugins: [elementsPlugin()] });
//
// Put `like-button.js` (and `like-button.css`, if it has styles) in the
// elements folder, and write <like-button> in a page: that page gets the
// script and stylesheet, and pages without the tag don't. `ssqch:load` on a
// tag says when the script loads: "eager", "idle" or "visible".
// Options: `dir` (default: `elements` in the input folder), `url` (default
// "/elements/") and `load` (the default for tags without `ssqch:load`).
export function elementsPlugin( options = {} ) {
	return { name: "ssqch/elements", builtin: "ssqch/elements", options };
}
