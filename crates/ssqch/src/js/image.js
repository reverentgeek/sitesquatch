// `ssqch/image`: responsive images.
//
//   import { imagePlugin, image } from "ssqch/image";
//
//   export default defineConfig({
//     plugins: [imagePlugin({ formats: ["avif", "webp", "auto"], widths: [600, 1200] })],
//   });
//
//   const derivatives = await image("src/hero.png", { widths: [600, 1200], formats: ["webp", "png"] });
//
// imagePlugin() turns every local <img> in HTML output into a <picture>.
// image() generates one image's derivatives with the same processor, so
// both share its cache, encoder settings and output folder.
import path from "node:path";

const native = globalThis.__ssqch.natives["ssqch/image"];

const FORMATS = [ "avif", "webp", "jpeg", "jpg", "png", "gif", "svg", "auto" ];
const IMAGE_OPTIONS = [ "widths", "formats", "name" ];

/** The <img> transform, with the encoder settings image() also uses. */
export function imagePlugin( options = {} ) {
	return { name: "ssqch/image", builtin: "ssqch/image", options };
}

function checkFormats( formats ) {
	Array.isArray( formats ) || fail( "formats must be an array" );
	for ( const f of formats ) {
		FORMATS.includes( f ) || fail( `unknown format "${ f }" (use ${ FORMATS.join( ", " ) })` );
	}
	return formats.map( f => f === "jpg" ? "jpeg" : f );
}

// "auto" (or 0) is the original width.
function checkWidths( widths ) {
	Array.isArray( widths ) || fail( "widths must be an array" );
	return widths.map( w => {
		if ( w === "auto" ) return 0;
		Number.isInteger( w ) && w >= 0 || fail( `widths must be whole numbers or "auto", got ${ JSON.stringify( w ) }` );
		return w;
	} );
}

function fail( message ) {
	throw new TypeError( `image(): ${ message }` );
}

/**
 * Generate an image's derivatives. Returns `{ [format]: [entry] }`, smallest
 * first, where each entry has format, width, height, url, sourceType, srcset,
 * filename, outputPath and size. Files are named after a hash of the source,
 * in the plugin's output folder; `name` gives them a name and folder of your
 * own ("/assets/sponsors/acme" writes /assets/sponsors/acme-200.webp).
 */
export async function image( src, options = {} ) {
	typeof src === "string" || fail( "the source must be a file path" );
	/^https?:\/\//.test( src ) && fail( `remote images aren't supported (${ src })` );
	for ( const key of Object.keys( options ) ) {
		IMAGE_OPTIONS.includes( key ) || fail( `unknown option "${ key }" (options: ${ IMAGE_OPTIONS.join( ", " ) }; encoder settings go on imagePlugin())` );
	}
	const { formats = [ "webp", "jpeg" ], widths = [ "auto" ], name } = options;
	name === undefined || typeof name === "string" && name.trim() || fail( "name must be a URL path without the width and extension, like \"/assets/sponsors/acme\"" );
	return native.generate( path.resolve( src ), checkWidths( widths ), checkFormats( formats ), name );
}
