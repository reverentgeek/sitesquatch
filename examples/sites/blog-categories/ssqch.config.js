import { defineConfig } from "ssqch";
import { readFileSync } from "node:fs";
import { linksPlugin } from "ssqch/links";
import { rssPlugin } from "ssqch/rss";
import { sitemapPlugin } from "ssqch/sitemap";

// Which site to build: `SITE=staging ssqch build`.
const siteName = process.env.SITE || "main";
const site = JSON.parse( readFileSync( `src/_data/sites/${ siteName }.json`, "utf8" ) );

const PER_PAGE = 2;
const slug = s => s.toLowerCase().replace( /[^a-z0-9]+/g, "-" ).replace( /^-|-$/g, "" );

export default defineConfig( {
	dirs: { input: "src", output: "dist" },
	templateFormats: [ "njk", "md" ],
	markdownEngine: "njk",
	strict: true,

	data: { site },
	filters: {
		slug,
		readableDate: date => date.toLocaleDateString( "en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" } )
	},

	collections: {
		posts: pages => pages.byGlob( "src/posts/*.md" ).reverse(),
		// One item per page of each category: { name, slug, number, pages, posts, previous, next }.
		categoryPages( pages ) {
			const byCategory = new Map();
			for ( const post of pages.byGlob( "src/posts/*.md" ).reverse() ) {
				for ( const name of post.data.categories ?? [] ) {
					if ( !byCategory.has( name ) ) byCategory.set( name, [] );
					byCategory.get( name ).push( post );
				}
			}
			const out = [];
			for ( const [ name, posts ] of [ ...byCategory ].sort( ( a, b ) => a[0].localeCompare( b[0] ) ) ) {
				const count = Math.ceil( posts.length / PER_PAGE );
				const url = n => `/category/${ slug( name ) }/${ n > 1 ? `${ n }/` : "" }`;
				for ( let n = 1; n <= count; n++ ) {
					out.push( {
						name, slug: slug( name ), number: n, pages: count, url: url( n ),
						posts: posts.slice( ( n - 1 ) * PER_PAGE, n * PER_PAGE ),
						previous: n > 1 ? url( n - 1 ) : null,
						next: n < count ? url( n + 1 ) : null
					} );
				}
			}
			return out;
		}
	},

	plugins: [ rssPlugin(), sitemapPlugin( { url: site.url } ), linksPlugin() ]
} );
