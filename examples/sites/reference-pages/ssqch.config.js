import { defineConfig } from "ssqch";
import { linksPlugin } from "ssqch/links";

export default defineConfig( {
	dirs: { input: "src", output: "dist" },
	templateFormats: [ "hbs" ],

	filters: {
		// The options grouped by category: [{ name, options }].
		byCategory( options ) {
			const groups = new Map();
			for ( const o of options ) groups.set( o.category, [ ...( groups.get( o.category ) ?? [] ), o ] );
			return [ ...groups ].map( ( [ name, list ] ) => ( { name, options: list } ) );
		}
	},

	plugins: [ linksPlugin() ]
} );
