import { defineConfig } from "ssqch";
import { linksPlugin } from "ssqch/links";
import { sitemapPlugin } from "ssqch/sitemap";

import languages from "./src/_data/languages.json";
import en from "./src/_data/strings/en.json";
import es from "./src/_data/strings/es.json";

const strings = { en, es };
const fallback = languages.find( l => l.default ).code;

// Every page's translations, by its `key` and then its language: { trails: { en: page, es: page } }.
// The collections below work it out once a build, and the filters and the sitemap read it.
let translations = new Map();

function group( pages ) {
	translations = new Map();
	for ( const page of pages ) {
		const { key, lang } = page.data;
		if ( key && lang ) translations.set( key, { ...translations.get( key ), [ lang ]: page } );
	}
}

// A page that isn't translated yet is written in the default language at the other language's
// address (/es/snacks/), so every language has every page and no link in it breaks.
function untranslated() {
	const out = [];
	for ( const [ key, pages ] of translations ) {
		const original = pages[ fallback ];
		if ( !original ) continue;
		for ( const { code } of languages ) {
			if ( !pages[ code ] ) out.push( { key, lang: code, url: original.url.replace( `/${ fallback }/`, `/${ code }/` ), page: original } );
		}
	}
	return out;
}

export default defineConfig( {
	dirs: { input: "src", output: "dist" },
	templateFormats: [ "jinja", "md" ],

	collections: {
		// Runs before the fallback pages are paginated over it, so the map is ready for them.
		untranslated: pages => {
			group( pages.byGlob( "src/*/*.md" ) );
			return untranslated();
		}
	},

	filters: {
		// A string in the page's language, or the default language's when it has none yet:
		// `{{ "nav.trails" | t(lang) }}`.
		t( name, lang ) {
			const find = table => name.split( "." ).reduce( ( at, part ) => at?.[ part ], table );
			return find( strings[ lang ] ) ?? find( strings[ fallback ] ) ?? name;
		},

		// Each language's version of the page with this key, in the order of languages.json: its
		// address, and whether it's a real translation or the fallback.
		versions( key ) {
			const pages = translations.get( key ) ?? {};
			return languages.flatMap( ( { code, name } ) => {
				if ( pages[ code ] ) return [ { lang: code, name, url: pages[ code ].url, translated: true } ];
				const standIn = untranslated().find( r => r.key === key && r.lang === code );
				return standIn ? [ { lang: code, name, url: standIn.url, translated: false } ] : [];
			} );
		}
	},

	plugins: [
		sitemapPlugin( {
			url: "https://sitesquatch.dev",
			// The same translations as the pages' hreflang links: real ones only.
			alternates: page => {
				const pages = translations.get( page.data.key );
				// A fallback page (its URL isn't its language's translation) has none: it's a copy.
				if ( !pages || pages[ page.data.lang ]?.url !== page.url ) return undefined;
				if ( Object.keys( pages ).length < 2 ) return undefined;
				return [
					...languages.filter( l => pages[ l.code ] ).map( l => ( { hreflang: l.code, href: pages[ l.code ].url } ) ),
					{ hreflang: "x-default", href: pages[ fallback ].url }
				];
			}
		} ),
		linksPlugin()
	]
} );
