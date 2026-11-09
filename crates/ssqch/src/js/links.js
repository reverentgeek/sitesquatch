// `ssqch/links`: a link checker.
//
//   import { linksPlugin } from "ssqch/links";
//
//   export default defineConfig({ plugins: [linksPlugin()] });
//
// After each build, every internal link (href, src, srcset) in the HTML has
// to point at something in the output, and a #fragment at an id on that
// page. External links aren't checked, and neither are paths a Netlify
// _redirects file covers. Broken links fail production builds and are
// warnings in `ssqch serve`. Options: `anchors` (check #fragments; default
// true), `ignore` (URL path prefixes to skip) and `fail` (true or false;
// production builds only by default).
export function linksPlugin( options = {} ) {
	return { name: "ssqch/links", builtin: "ssqch/links", options };
}
