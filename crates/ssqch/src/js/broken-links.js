// Stands in for `eleventy-plugin-broken-links`, which ssqch doesn't have yet.
let warned = false;
export default function brokenLinksPlugin() {
	if ( !warned ) {
		warned = true;
		console.warn( "warn: eleventy-plugin-broken-links isn't available in ssqch; skipping it" );
	}
}
