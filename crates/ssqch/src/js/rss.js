// `ssqch/rss`: feed helpers.
//
//   import { rssPlugin, absoluteUrl } from "ssqch/rss";
//
//   export default defineConfig({ plugins: [rssPlugin()] });
//
// rssPlugin() adds the filters getNewestCollectionItemDate, dateToRfc3339,
// dateToRfc822, absoluteUrl, htmlToAbsoluteUrls and feedHtml to templates. The
// named exports are the same functions, for use in your own code.
const native = globalThis.__ssqch.natives["ssqch/rss"];

export function rssPlugin() {
	return { name: "ssqch/rss", builtin: "ssqch/rss" };
}

export const getNewestCollectionItemDate = collection => native.newestItemDate( collection );
export const dateToRfc3339 = date => native.dateToRfc3339( date );
export const dateToRfc822 = date => native.dateToRfc822( date );
export const absoluteUrl = ( url, base ) => native.absoluteUrl( String( url ), String( base ) );
export const htmlToAbsoluteUrls = ( html, base ) => native.htmlToAbsoluteUrls( String( html ?? "" ), String( base ) );
// A post's HTML for a feed: one generated copy for each local image, and every URL absolute.
export const feedHtml = ( html, base, options ) => native.feedHtml( html ?? "", String( base ), options );
