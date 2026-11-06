// `ssqch:minify`, which also answers to `html-minifier-terser`.
//
//   import htmlmin from "html-minifier-terser";
//   const html = await htmlmin.minify(content, { collapseWhitespace: true, removeComments: true });
//
// Supports collapseWhitespace, removeComments and useShortDoctype; other
// options are ignored with a warning. Like html-minifier, every option is
// off unless set.
const native = globalThis.__ssqch.natives["ssqch:minify"];

const SUPPORTED = [ "collapseWhitespace", "removeComments", "useShortDoctype" ];
const warned = new Set();

export async function minify( html, options = {} ) {
	for ( const key of Object.keys( options ) ) {
		if ( !SUPPORTED.includes( key ) && !warned.has( key ) ) {
			warned.add( key );
			console.warn( `warn: html-minifier option ${ key } is ignored by ssqch (supported: ${ SUPPORTED.join( ", " ) })` );
		}
	}
	return native.minify( String( html ), Boolean( options.collapseWhitespace ), Boolean( options.removeComments ), Boolean( options.useShortDoctype ) );
}

export default { minify };
