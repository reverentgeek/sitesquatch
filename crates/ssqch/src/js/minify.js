// `ssqch/minify`: HTML minification.
//
//   import { minifyPlugin, minify } from "ssqch/minify";
//
//   export default defineConfig(({ env }) => ({
//     plugins: [env === "production" && minifyPlugin()],
//   }));
//
//   const small = minify(html, { removeComments: false });
//
// minifyPlugin() minifies every HTML output file, after the image transform.
// Options (all on by default): collapseWhitespace, removeComments and
// shortDoctype.
const native = globalThis.__ssqch.natives["ssqch/minify"];

const OPTIONS = [ "collapseWhitespace", "removeComments", "shortDoctype" ];

export function minifyPlugin( options = {} ) {
	return { name: "ssqch/minify", builtin: "ssqch/minify", options };
}

export function minify( html, options = {} ) {
	for ( const key of Object.keys( options ) ) {
		if ( !OPTIONS.includes( key ) ) throw new TypeError( `minify(): unknown option "${ key }" (options: ${ OPTIONS.join( ", " ) })` );
	}
	const { collapseWhitespace = true, removeComments = true, shortDoctype = true } = options;
	return native.minify( String( html ), Boolean( collapseWhitespace ), Boolean( removeComments ), Boolean( shortDoctype ) );
}
