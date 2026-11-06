// `ssqch:rss`, which also answers to `@11ty/eleventy-plugin-rss`.
//
//   import pluginRss, { dateToRfc3339, absoluteUrl } from "@11ty/eleventy-plugin-rss";
//   config.addPlugin(pluginRss);
//
// The default export adds the plugin's filters (getNewestCollectionItemDate,
// dateToRfc3339, dateToRfc822, absoluteUrl, htmlToAbsoluteUrls); the named
// exports are the same functions, for registering yourself.
const native = globalThis.__ssqch.natives["ssqch:rss"];

export default function rssPlugin( config ) {
	config.addPlugin( "ssqch:rss" );
}

export const getNewestCollectionItemDate = collection => native.newestItemDate( collection );
export const dateToRfc3339 = date => native.dateToRfc3339( date );
export const dateToRfc822 = date => native.dateToRfc822( date );
export const absoluteUrl = ( url, base ) => native.absoluteUrl( String( url ), String( base ) );
// Async, like the plugin's.
export const convertHtmlToAbsoluteUrls = async ( html, base ) => native.htmlToAbsoluteUrls( String( html ?? "" ), String( base ) );

export function feedPlugin() {
	throw new Error( "feedPlugin (the virtual feed template) isn't supported by ssqch; write the feed template yourself" );
}
