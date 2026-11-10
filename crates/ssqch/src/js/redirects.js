// `ssqch/redirects`: old URLs that send visitors to new ones.
//
//   import { redirectsPlugin } from "ssqch/redirects";
//
//   export default defineConfig({ plugins: [redirectsPlugin({ netlify: true })] });
//
// Old URLs come from each page's `aliases` front matter and from the
// `redirects` option ({ "/old/": "/new/" }). Each one becomes a redirect page
// (`pages`, default true), a line in a Netlify `_redirects` file (`netlify`,
// default false), or both.
export function redirectsPlugin( options = {} ) {
	return { name: "ssqch/redirects", builtin: "ssqch/redirects", options };
}
