import { defineConfig } from "ssqch";
import fs from "node:fs";
import { linksPlugin } from "ssqch/links";
import { sassPlugin } from "ssqch/sass";

export default defineConfig( {
	dirs: { input: "src", output: "dist" },
	templateFormats: [ "edge", "md" ],
	markdown: { highlight: true },

	filters: {
		// The lines of a Sass file between `// scss-docs-start name` and `// scss-docs-end name`.
		scssDocs( file, name ) {
			const lines = fs.readFileSync( `src/${ file }`, "utf8" ).split( "\n" );
			const start = lines.findIndex( l => l.trim() === `// scss-docs-start ${ name }` );
			const end = lines.findIndex( ( l, i ) => i > start && l.trim() === `// scss-docs-end ${ name }` );
			if ( start < 0 || end < 0 ) throw new Error( `scssDocs: no "${ name }" region in ${ file }` );
			return lines.slice( start + 1, end ).join( "\n" );
		}
	},

	plugins: [
		sassPlugin( { files: { "src/scss/pinecone.scss": "/css/pinecone.css" } } ),
		linksPlugin()
	]
} );
