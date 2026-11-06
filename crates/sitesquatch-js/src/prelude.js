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

	const HOOKS = [ "eleventy.before", "eleventy.after" ];

	// Eleventy's collection API over every page in collections (oldest first).
	// Tag filtering runs in Rust, and results are fresh copy-on-write views,
	// so an item only becomes a JavaScript object when something reads it.
	function collectionApi( items ) {
		const views = globalThis.__ssqch.views;
		const handle = globalThis.__ssqch.unwrapView( items );
		return {
			getAll: () => views.select( handle, null ),
			getAllSorted: () => views.select( handle, null ),
			getFilteredByTag: tag => views.select( handle, [ String( tag ) ] ),
			getFilteredByTags: ( ...tags ) => views.select( handle, tags.map( String ) ),
			getFilteredByGlob( globs ) {
				const patterns = [].concat( globs ).map( globToRegExp );
				return items.filter( item => patterns.some( re => re.test( stripDot( item.inputPath ) ) ) );
			}
		};
	}

	const stripDot = p => String( p ).replace( /^\.\//, "" );

	// `*`, `**`, `?`, `[abc]` and `{a,b}` globs, matched against whole paths.
	function globToRegExp( glob ) {
		const g = stripDot( glob );
		let re = "";
		let braces = 0;
		for ( let i = 0; i < g.length; i++ ) {
			const c = g[i];
			if ( c === "*" && g[i + 1] === "*" ) {
				const slash = g[i + 2] === "/";
				re += slash ? "(?:.*/)?" : ".*";
				i += slash ? 2 : 1;
			} else if ( c === "*" ) re += "[^/]*";
			else if ( c === "?" ) re += "[^/]";
			else if ( c === "[" ) {
				const end = g.indexOf( "]", i );
				if ( end === -1 ) re += "\\[";
				else {
					re += "[" + g.slice( i + 1, end ).replace( /^!/, "^" ) + "]";
					i = end;
				}
			} else if ( c === "{" ) {
				braces++;
				re += "(?:";
			} else if ( c === "}" && braces ) {
				braces--;
				re += ")";
			} else if ( c === "," && braces ) re += "|";
			else re += c.replace( /[.+^$()|\\]/g, "\\$&" );
		}
		return new RegExp( `^${ re }$` );
	}

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

			addCollection( name, fn ) {
				needName( "addCollection", name );
				needFn( "addCollection", fn );
				ops.push( { op: "collection", name, fn: keep( items => fn( collectionApi( items ) ) ) } );
			},

			// Called as fn.call({ page }, content, outputPath), like Eleventy.
			addTransform( name, fn ) {
				needName( "addTransform", name );
				needFn( "addTransform", fn );
				const run = async ( content, page ) => {
					const out = await fn.call( { page, inputPath: page.inputPath, outputPath: page.outputPath, url: page.url }, content, page.outputPath );
					if ( typeof out !== "string" ) {
						throw new TypeError( `transform "${ name }" returned ${ out === undefined ? "undefined" : typeof out } for ${ page.outputPath }; return the content (unchanged if there's nothing to do)` );
					}
					return out;
				};
				ops.push( { op: "transform", name, fn: keep( run ) } );
			},

			on( event, fn ) {
				if ( !HOOKS.includes( event ) ) fail( `config.on(): unknown event "${ event }" (supported: ${ HOOKS.join( ", " ) })` );
				needFn( "on", fn );
				ops.push( { op: "hook", event, fn: keep( fn ) } );
			},
			addPairedShortcode: notYet( "addPairedShortcode" ),
			addPairedAsyncShortcode: notYet( "addPairedAsyncShortcode" ),
			addExtension: notYet( "addExtension" ),
			addTemplateFormats: notYet( "addTemplateFormats" ),
			setLayoutsDirectory: notYet( "setLayoutsDirectory" )
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
		// Eleventy settings with nothing to do here.
		delete rest.passthroughFileCopy;
		for ( const [ key, value ] of Object.entries( rest ) ) {
			if ( !known.includes( key ) ) fail( `${ where }: "${ key }" isn't a supported setting (supported: dir, ${ known.join( ", " ) })` );
			settings[key] = value;
		}
	}

	// ---- Views of template values (see views.rs).
	//
	// A view is a Proxy over an empty object or a sparse array of the right
	// length. Reading a property fetches it from Rust once and caches it on
	// the target. The first write (or delete, or defineProperty) copies every
	// property in, after which the proxy is just its target. One handler
	// serves every view. Each view's state sits on its target under a private
	// symbol, hidden from ownKeys (QuickJS's WeakMap is 25x slower to read).
	const STATE = Symbol( "ssqch.view" );
	const MISSING = Symbol( "ssqch.missing" );
	const viewsByIdentity = new Map();
	let nativeViews;
	const natives = () => nativeViews ??= globalThis.__ssqch.views;

	const isDataKey = ( s, k ) => {
		if ( typeof k !== "string" ) return false;
		if ( s.isArray ) {
			const i = k.length < 11 ? Number( k ) : NaN;
			return i >= 0 && i < s.length && String( i ) === k;
		}
		return ( s.keySet ??= new Set( s.keys ??= natives().keys( s.handle ) ) ).has( k );
	};
	const ensure = ( s, t, k ) => {
		if ( !s.copied && !Object.hasOwn( t, k ) && isDataKey( s, k ) ) {
			Object.defineProperty( t, k, { value: natives().get( s.handle, k, MISSING ), writable: true, enumerable: true, configurable: true } );
		}
	};
	const copyIn = ( s, t ) => {
		if ( s.copied ) return;
		if ( s.isArray ) for ( let i = 0; i < s.length; i++ ) ensure( s, t, String( i ) );
		else for ( const k of s.keys ??= natives().keys( s.handle ) ) ensure( s, t, k );
		s.copied = true;
	};
	const viewHandler = {
		// Reads ask Rust for the key directly (no key list needed); a missing
		// key falls through to the prototype (hasOwnProperty, map, ...).
		get( t, k, receiver ) {
			if ( typeof k === "string" && !Object.hasOwn( t, k ) ) {
				const s = t[STATE];
				if ( !s.copied && ( !s.isArray || isDataKey( s, k ) ) ) {
					const v = natives().get( s.handle, k, MISSING );
					if ( v !== MISSING ) Object.defineProperty( t, k, { value: v, writable: true, enumerable: true, configurable: true } );
				}
			}
			return Reflect.get( t, k, receiver );
		},
		has( t, k ) {
			const s = t[STATE];
			return ( !s.copied && isDataKey( s, k ) ) || Reflect.has( t, k );
		},
		ownKeys( t ) {
			const s = t[STATE];
			const own = Reflect.ownKeys( t ).filter( k => k !== STATE );
			if ( s.copied ) return own;
			if ( s.isArray ) {
				const out = Array.from( { length: s.length }, ( _, i ) => String( i ) );
				for ( const k of own ) if ( !isDataKey( s, k ) ) out.push( k );
				return out;
			}
			const keys = s.keys ??= natives().keys( s.handle );
			const seen = s.keySet ??= new Set( keys );
			return [ ...keys, ...own.filter( k => !seen.has( k ) ) ];
		},
		getOwnPropertyDescriptor( t, k ) {
			if ( k === STATE ) return undefined;
			ensure( t[STATE], t, k );
			return Reflect.getOwnPropertyDescriptor( t, k );
		},
		set( t, k, v, receiver ) {
			const s = t[STATE];
			copyIn( s, t );
			return Reflect.set( t, k, v, receiver === s.proxy ? t : receiver );
		},
		defineProperty( t, k, d ) {
			copyIn( t[STATE], t );
			return Reflect.defineProperty( t, k, d );
		},
		deleteProperty( t, k ) {
			copyIn( t[STATE], t );
			return Reflect.deleteProperty( t, k );
		}
	};

	// `identity` is 0 for a view that must not be shared (a fresh getAll()).
	function view( handle, identity, isArray, length ) {
		if ( identity ) {
			const existing = viewsByIdentity.get( identity );
			if ( existing ) return existing;
		}
		const target = isArray ? [] : {};
		if ( isArray ) target.length = length;
		const s = { handle, isArray, length, keys: null, keySet: null, copied: false, proxy: null };
		Object.defineProperty( target, STATE, { value: s, configurable: true } );
		const proxy = new Proxy( target, viewHandler );
		s.proxy = proxy;
		if ( identity ) viewsByIdentity.set( identity, proxy );
		return proxy;
	}

	globalThis.__ssqch = {
		fns,
		keep,
		dateMs: v => v instanceof Date ? v.getTime() : undefined,
		makeDate: ms => new Date( ms ),
		isArray: v => Array.isArray( v ),
		view,
		// The handle behind an unmodified view, so it returns to Rust uncopied.
		unwrapView( v ) {
			const state = v !== null && typeof v === "object" ? v[STATE] : undefined;
			return state && state.proxy === v && !state.copied ? state.handle : undefined;
		},
		// Views are shared by identity only within one call into JavaScript.
		endCall() {
			viewsByIdentity.clear();
		},

		// A data file's value: its default export, called if it's a function.
		async loadData( module ) {
			if ( !( "default" in module ) ) throw new Error( "a data file needs a default export: the data, or a function that returns it" );
			const value = module.default;
			return typeof value === "function" ? await value() : value;
		},

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
