// The reference's data, generated from the schema on each build.
import fs from "node:fs";

export default function () {
	const schema = JSON.parse( fs.readFileSync( "schema/squatchrc.schema.json", "utf8" ) );
	return Object.entries( schema.properties )
		.map( ( [ name, o ] ) => ( {
			name,
			category: o.category,
			type: o.type,
			description: o.description,
			// Written out as JSON (`false`, `["pine cones"]`), or null for none.
			default: o.default === undefined ? null : JSON.stringify( o.default ),
			related: o.related ?? []
		} ) )
		.sort( ( a, b ) => a.name.localeCompare( b.name ) );
}
