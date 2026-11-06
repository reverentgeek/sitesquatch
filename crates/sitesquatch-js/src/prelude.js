// Runs once per engine, before the site's config module is imported.
// Defines `console` and the `config` object handed to `ssqch.config.js`.
//
// Registrations are recorded as plain data (`ops`) in call order, then read
// back by Rust. JavaScript functions are kept in `fns` and referred to by
// index, so Rust never holds a JavaScript value between calls.
( () => {
	const print = globalThis.__ssqch_print;
	delete globalThis.__ssqch_print;

	const fns = [];
	const keep = fn => fns.push( fn ) - 1;

	const show = v => {
		if ( typeof v === "string" ) return v;
		if ( v instanceof Error ) return v.stack ? `${ v.name }: ${ v.message }\n${ v.stack }` : String( v );
		if ( typeof v === "function" ) return `[Function ${ v.name || "(anonymous)" }]`;
		if ( v === undefined || typeof v === "symbol" || typeof v === "bigint" ) return String( v );
		try {
			return JSON.stringify( v, null, 2 ) ?? String( v );
		} catch {
			return String( v );
		}
	};
	const log = level => ( ...args ) => print( level, args.map( show ).join( " " ) );
	globalThis.console = { log: log( 0 ), info: log( 0 ), debug: log( 0 ), warn: log( 1 ), error: log( 2 ) };

	const fail = message => { throw new TypeError( message ); };
	const needName = ( method, name ) => typeof name === "string" && name !== "" || fail( `config.${ method }(): the name must be a non-empty string` );
	const needFn = ( method, fn ) => typeof fn === "function" || fail( `config.${ method }(): the second argument must be a function` );

	function makeConfig( env, serving ) {
		const ops = [];
		const settings = {};
		const pending = [];

		const filter = method => ( name, fn ) => {
			needName( method, name );
			needFn( method, fn );
			ops.push( { op: "filter", name, fn: keep( fn ) } );
		};
		const notYet = method => () => fail( `config.${ method }() isn't supported by ssqch yet` );
		const dir = key => path => {
			typeof path === "string" || fail( `config.set${ key[0].toUpperCase() + key.slice( 1 ) }Directory(): expected a string` );
			settings[key] = path;
		};

		const config = {
			env,
			serving,
			isProduction: env === "production",
			isDevelopment: env === "development",

			addFilter: filter( "addFilter" ),
			addAsyncFilter: filter( "addAsyncFilter" ),
			addShortcode: filter( "addShortcode" ),
			addAsyncShortcode: filter( "addAsyncShortcode" ),
			addJavaScriptFunction: filter( "addJavaScriptFunction" ),

			addGlobalData( name, value ) {
				needName( "addGlobalData", name );
				ops.push( typeof value === "function" ? { op: "data", name, fn: keep( value ) } : { op: "data", name, value } );
			},

			addPassthroughCopy( paths ) {
				if ( typeof paths === "string" ) {
					ops.push( { op: "passthrough", from: paths } );
				} else if ( paths && typeof paths === "object" ) {
					for ( const [ from, to ] of Object.entries( paths ) ) {
						typeof to === "string" || fail( `config.addPassthroughCopy(): the destination for "${ from }" must be a string` );
						ops.push( { op: "passthrough", from, to } );
					}
				} else {
					fail( "config.addPassthroughCopy(): expected a path or an object of { from: to } paths" );
				}
			},

			addWatchTarget( path ) {
				typeof path === "string" || fail( "config.addWatchTarget(): expected a path" );
				ops.push( { op: "watch", path } );
			},

			// A function plugin is called right away with (config, options), like
			// Eleventy. A string names a built-in ssqch plugin, such as "ssqch:image".
			addPlugin( plugin, options = {} ) {
				if ( typeof plugin === "function" ) {
					const result = plugin( config, options );
					if ( result && typeof result.then === "function" ) pending.push( result );
				} else if ( typeof plugin === "string" ) {
					ops.push( { op: "plugin", name: plugin, options } );
				} else {
					fail( "config.addPlugin(): expected a function or the name of a built-in plugin (\"ssqch:image\")" );
				}
			},

			setDataDeepMerge( on ) {
				settings.dataDeepMerge = Boolean( on );
			},
			setTemplateFormats( formats ) {
				settings.templateFormats = formats;
			},
			setInputDirectory: dir( "input" ),
			setOutputDirectory: dir( "output" ),
			setIncludesDirectory: dir( "includes" ),
			setDataDirectory: dir( "data" ),

			// Eleventy settings with nothing to do here.
			setUseGitIgnore() {},
			setQuietMode() {},
			configureErrorReporting() {},

			addCollection: notYet( "addCollection" ),
			addTransform: notYet( "addTransform" ),
			addPairedShortcode: notYet( "addPairedShortcode" ),
			addPairedAsyncShortcode: notYet( "addPairedAsyncShortcode" ),
			addExtension: notYet( "addExtension" ),
			addTemplateFormats: notYet( "addTemplateFormats" ),
			setLayoutsDirectory: notYet( "setLayoutsDirectory" ),
			on: notYet( "on" )
		};
		return { config, ops, settings, pending };
	}

	// Eleventy's return object (and `export const config`): directories and engines.
	function applyReturned( settings, returned, where ) {
		if ( returned === undefined || returned === null ) return;
		if ( typeof returned !== "object" ) fail( `${ where } must be an object` );
		const { dir, ...rest } = returned;
		if ( dir !== undefined ) {
			for ( const [ key, value ] of Object.entries( dir ) ) {
				if ( ![ "input", "output", "includes", "data" ].includes( key ) ) fail( `${ where }: dir.${ key } isn't supported (use input, output, includes and data)` );
				settings[key] = value;
			}
		}
		const known = [ "templateFormats", "markdownTemplateEngine", "htmlTemplateEngine", "dataDeepMerge" ];
		for ( const [ key, value ] of Object.entries( rest ) ) {
			if ( !known.includes( key ) ) fail( `${ where }: "${ key }" isn't a supported setting (supported: dir, ${ known.join( ", " ) })` );
			settings[key] = value;
		}
	}

	globalThis.__ssqch = {
		fns,
		keep,
		dateMs: v => v instanceof Date ? v.getTime() : undefined,
		makeDate: ms => new Date( ms ),

		async run( module, env, serving ) {
			const { config, ops, settings, pending } = makeConfig( env, serving );
			applyReturned( settings, module.config, "export const config" );
			const main = module.default;
			if ( typeof main === "function" ) {
				applyReturned( settings, await main( config ), "the object returned by the config function" );
			} else if ( main !== undefined ) {
				applyReturned( settings, main, "export default" );
			}
			await Promise.all( pending );
			return { ops, settings };
		}
	};
} )();
