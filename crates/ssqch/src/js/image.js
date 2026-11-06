// `ssqch:image`, which also answers to `@11ty/eleventy-img`.
//
//   import Image, { eleventyImageTransformPlugin } from "@11ty/eleventy-img";
//   const metadata = await Image("src/hero.png", { widths: [600, 1200], formats: ["webp", "png"] });
//
// Images come from the same processor as the `<img>` transform, so they share
// its cache, encoder settings and output folder. Options ssqch can't honor
// (sharp settings, transform functions) are ignored with a warning.
import path from "node:path";

const native = globalThis.__ssqch.natives["ssqch:image"];

const warned = new Set();
const warnOnce = message => {
	if ( !warned.has( message ) ) {
		warned.add( message );
		console.warn( `warn: ${ message }` );
	}
};

const FORMATS = [ "avif", "webp", "jpeg", "jpg", "png", "gif", "svg", "auto" ];
const SHARP = { sharpWebpOptions: "webpQuality", sharpAvifOptions: "avifQuality", sharpJpegOptions: "jpegQuality" };

function checkFormats( formats, where ) {
	for ( const f of formats ) {
		if ( !FORMATS.includes( f ) ) throw new TypeError( `${ where }: unknown format "${ f }" (use ${ FORMATS.join( ", " ) })` );
	}
	return formats.map( f => f === "jpg" ? "jpeg" : f );
}

function widthsOf( widths ) {
	return widths.map( w => w === null || w === "auto" ? 0 : Number( w ) );
}

// Warn about options that change Eleventy's output but not ssqch's.
function noteIgnored( options, where, settings ) {
	for ( const [ key, value ] of Object.entries( options ) ) {
		if ( key in SHARP ) {
			const { quality, ...rest } = value || {};
			if ( quality !== undefined && settings && quality !== settings[SHARP[key]] ) {
				warnOnce( `${ where }: ${ key }.quality ${ quality } is ignored; this build encodes at ${ SHARP[key] } ${ settings[SHARP[key]] } (set it on the ssqch:image plugin)` );
			}
			const others = Object.keys( rest );
			if ( others.length ) warnOnce( `${ where }: ${ key }.${ others.join( ", " ) } ${ others.length > 1 ? "are" : "is" } ignored (ssqch doesn't use sharp)` );
		} else if ( key === "transform" ) {
			warnOnce( `${ where }: the transform function is ignored (ssqch doesn't use sharp, and drops color profiles without converting colors)` );
		} else {
			warnOnce( `${ where }: the ${ key } option is ignored by ssqch` );
		}
	}
}

/** Generate an image's derivatives, returning eleventy-img's metadata shape. */
export default async function Image( src, options = {} ) {
	if ( typeof src !== "string" ) throw new TypeError( "Image(): ssqch only accepts a file path" );
	if ( /^https?:\/\//.test( src ) ) throw new Error( `Image(): remote images aren't supported by ssqch (${ src })` );
	const { formats = [ "webp", "jpeg" ], widths = [ "auto" ], outputDir, urlPath, ...rest } = options;
	const settings = native.settings();
	if ( outputDir !== undefined && path.resolve( outputDir ) !== settings.outputDir ) {
		throw new Error( `Image(): outputDir "${ outputDir }" isn't where this build writes images (${ path.relative( process.cwd(), settings.outputDir ) || "." }); set outputDir on the ssqch:image plugin instead` );
	}
	if ( urlPath !== undefined && urlPath.replace( /\/?$/, "/" ) !== settings.urlPath ) {
		throw new Error( `Image(): urlPath "${ urlPath }" doesn't match this build's image URL path (${ settings.urlPath }); set urlPath on the ssqch:image plugin instead` );
	}
	noteIgnored( rest, "Image()", settings );
	return native.generate( path.resolve( src ), widthsOf( widths ), checkFormats( formats, "Image()" ) );
}

/** Eleventy's `<img>` transform plugin, as the ssqch:image plugin. */
export function eleventyImageTransformPlugin( config, options = {} ) {
	const { formats, widths, defaultAttributes, urlPath, outputDir, ...rest } = options;
	const mapped = {};
	if ( formats !== undefined ) mapped.formats = checkFormats( formats, "eleventyImageTransformPlugin" );
	if ( widths !== undefined ) mapped.widths = widthsOf( widths );
	if ( defaultAttributes !== undefined ) mapped.defaultAttributes = defaultAttributes;
	if ( urlPath !== undefined ) mapped.urlPath = urlPath;
	if ( outputDir !== undefined ) warnOnce( "eleventyImageTransformPlugin: outputDir is ignored; images go to the img folder in the output (set outputDir on the ssqch:image plugin)" );
	for ( const [ key, setting ] of Object.entries( SHARP ) ) {
		if ( rest[key] && rest[key].quality !== undefined ) {
			mapped[setting] = rest[key].quality;
			const { quality, ...others } = rest[key];
			rest[key] = others;
			if ( !Object.keys( others ).length ) delete rest[key];
		}
	}
	noteIgnored( rest, "eleventyImageTransformPlugin", null );
	config.addPlugin( "ssqch:image", mapped );
}

Image.eleventyImageTransformPlugin = eleventyImageTransformPlugin;
