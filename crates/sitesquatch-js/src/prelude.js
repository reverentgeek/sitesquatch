// Runs once per engine, before the site's config module is imported.
// Defines `console`, and reads the object `ssqch.config.js` exports.
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

	// The collection API: every page in collections (oldest first). Tag
	// filtering runs in Rust, and results are fresh copy-on-write views, so an
	// item only becomes a JavaScript object when something reads it.
	function collectionApi( items ) {
		const views = globalThis.__ssqch.views;
		const handle = globalThis.__ssqch.unwrapView( items );
		return {
			all: () => views.select( handle, null ),
			byTag: tag => views.select( handle, [ String( tag ) ] ),
			byTags: ( ...tags ) => views.select( handle, tags.map( String ) ),
			byGlob( globs ) {
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

	// ---- The config object.
	//
	//   export default defineConfig(({ env, serving }) => ({ dirs, filters, plugins, ... }));
	//
	// A config (or a plugin) is a plain object; a function returning one (sync
	// or async) gets `{ env, serving }`. Settings only make sense once, so
	// they're allowed at the top level only. Everything else can also come from
	// a plugin, and is applied in order: the config's own entries first, then
	// each plugin's, depth first.
	const SETTINGS = [ "dirs", "templateFormats", "markdownEngine", "htmlEngine", "markdown", "deepMerge", "leaveNoTrace", "clean", "ignore", "bundles", "strict", "lastModified", "base", "schemas", "theme" ];
	const PARTS = [ "data", "filters", "collections", "transforms", "engines", "passthrough", "watch", "beforeBuild", "afterBuild", "plugins" ];
	// Engine names a config can't replace.
	const CORE_ENGINES = [ "edge", "md", "html", "txt" ];
	const DIRS = [ "input", "output", "includes", "layouts", "data" ];

	const isObject = v => v !== null && typeof v === "object" && !Array.isArray( v );
	const list = v => v === undefined ? [] : [].concat( v );

	// ` (did you mean "dirs"?)` for a key within two edits of an option, or nothing.
	const meant = ( key, options ) => {
		const distance = ( a, b ) => {
			const row = Array.from( { length: b.length + 1 }, ( _, i ) => i );
			for ( let i = 0; i < a.length; i++ ) {
				let previous = row[0];
				row[0] = i + 1;
				for ( let j = 0; j < b.length; j++ ) {
					const current = row[j + 1];
					row[j + 1] = a[i] === b[j] ? previous : 1 + Math.min( previous, current, row[j] );
					previous = current;
				}
			}
			return row[b.length];
		};
		let best;
		for ( const option of options ) {
			const edits = distance( String( key ).toLowerCase(), option.toLowerCase() );
			if ( edits <= 2 && edits < option.length && ( !best || edits < best.edits ) ) best = { edits, option };
		}
		return best ? ` (did you mean "${ best.option }"?)` : "";
	};

	async function collect( env, serving ) {
		const ops = [];
		const settings = {};
		const names = { data: new Map(), filters: new Map(), collections: new Map(), transforms: new Map(), engines: new Map() };
		const context = Object.freeze( { env, serving } );

		const claim = ( kind, singular, name, where ) => {
			const earlier = names[kind].get( name );
			if ( earlier ) fail( `${ where }: ${ singular } "${ name }" is already defined by ${ earlier }` );
			names[kind].set( name, where );
		};
		const functions = ( kind, singular, value, where, add ) => {
			if ( value === undefined ) return;
			isObject( value ) || fail( `${ where }: ${ kind } must be an object of { name: function }` );
			for ( const [ name, fn ] of Object.entries( value ) ) {
				typeof fn === "function" || fail( `${ where }: ${ kind }.${ name } must be a function` );
				claim( kind, singular, name, where );
				add( name, fn );
			}
		};
		// A hook is a function, or `{ run: "command" }` to run a program.
		const hooks = ( event, value, where ) => {
			for ( const hook of list( value ) ) {
				if ( isObject( hook ) ) {
					for ( const key of Object.keys( hook ) ) {
						key === "run" || fail( `${ where }: ${ event }: "${ key }" isn't an option (use { run: "command" })` );
					}
					typeof hook.run === "string" && hook.run.trim() || fail( `${ where }: ${ event }: run must be a command, like { run: "pagefind --site dist" }` );
					ops.push( { op: "hook", event, run: hook.run, where } );
					continue;
				}
				typeof hook === "function" || fail( `${ where }: ${ event } must be a function or { run: "command" } (or an array of them)` );
				ops.push( { op: "hook", event, fn: keep( hook ), where } );
			}
		};

		async function apply( part, where, top ) {
			if ( typeof part === "function" ) part = await part( context );
			if ( part === undefined || part === null || part === false ) return;
			isObject( part ) || fail( `${ where } must be an object (or a function that returns one)` );

			// A built-in plugin, such as imagePlugin() from "ssqch/image".
			if ( "builtin" in part ) {
				ops.push( { op: "plugin", name: part.builtin, options: part.options ?? {} } );
				return;
			}

			for ( const key of Object.keys( part ) ) {
				if ( key === "name" && !top ) {
					continue;
				} else if ( SETTINGS.includes( key ) ) {
					top || fail( `${ where }: "${ key }" can only be set in the config itself, not in a plugin` );
				} else if ( !PARTS.includes( key ) ) {
					const options = top ? [ ...SETTINGS, ...PARTS ] : PARTS;
					// `output: "dist"` at the top is a folder that belongs in `dirs`.
					const hint = top && DIRS.includes( key ) ? ` (it goes in dirs: { ${ key }: "..." })` : meant( key, options );
					fail( `${ where }: "${ key }" isn't a config option${ hint } (options: ${ options.join( ", " ) })` );
				}
			}

			if ( top ) {
				if ( part.dirs !== undefined ) {
					isObject( part.dirs ) || fail( `${ where }: dirs must be an object` );
					for ( const [ key, value ] of Object.entries( part.dirs ) ) {
						DIRS.includes( key ) || fail( `${ where }: dirs.${ key } isn't supported${ meant( key, DIRS ) } (use ${ DIRS.join( ", " ) })` );
						typeof value === "string" || fail( `${ where }: dirs.${ key } must be a string` );
						settings[key] = value;
					}
				}
				for ( const key of SETTINGS.filter( k => k !== "dirs" ) ) {
					if ( part[key] !== undefined ) settings[key] = part[key];
				}
				// `markdown: { headingIds: text => id }`: a slugger of your own.
				if ( isObject( part.markdown ) && typeof part.markdown.headingIds === "function" ) {
					settings.markdownSlugger = keep( part.markdown.headingIds );
					settings.markdown = { ...part.markdown, headingIds: true };
				}
			}

			if ( part.data !== undefined ) {
				isObject( part.data ) || fail( `${ where }: data must be an object of { name: value or function }` );
				for ( const [ name, value ] of Object.entries( part.data ) ) {
					claim( "data", "data", name, where );
					ops.push( typeof value === "function" ? { op: "data", name, fn: keep( value ) } : { op: "data", name, value } );
				}
			}
			functions( "filters", "filter", part.filters, where, ( name, fn ) => ops.push( { op: "filter", name, fn: keep( fn ) } ) );
			functions( "collections", "collection", part.collections, where, ( name, fn ) => ops.push( { op: "collection", name, fn: keep( items => fn( collectionApi( items ) ) ) } ) );
			functions( "transforms", "transform", part.transforms, where, ( name, fn ) => {
				const run = async ( content, page ) => {
					const out = await fn( content, page );
					if ( typeof out !== "string" ) {
						throw new TypeError( `transform "${ name }" returned ${ out === undefined ? "undefined" : typeof out } for ${ page.outputPath }; return the content (unchanged if there's nothing to do)` );
					}
					return out;
				};
				ops.push( { op: "transform", name, fn: keep( run ) } );
			} );
			if ( part.engines !== undefined ) {
				isObject( part.engines ) || fail( `${ where }: engines must be an object of { extension: function or { render } }` );
				for ( const [ name, engine ] of Object.entries( part.engines ) ) {
					const render = typeof engine === "function" ? engine : engine?.render;
					typeof render === "function" || fail( `${ where }: engines.${ name } must be a function (source, data) or an object with a render(source, data) method` );
					/^[A-Za-z0-9_-]+$/.test( name ) || fail( `${ where }: engines.${ name }: an engine's name is a file extension (letters, digits, - and _)` );
					CORE_ENGINES.includes( name ) && fail( `${ where }: engines.${ name }: "${ name }" is built in and can't be replaced` );
					claim( "engines", "engine", name, where );
					const run = async ( source, data, inputPath ) => {
						const out = await render.call( engine, source, data );
						if ( typeof out !== "string" ) {
							throw new TypeError( `engine "${ name }" returned ${ out === undefined ? "undefined" : typeof out } for ${ inputPath }; return the rendered text` );
						}
						return out;
					};
					ops.push( { op: "engine", name, fn: keep( run ) } );
				}
			}

			for ( const entry of list( part.passthrough ) ) {
				if ( typeof entry === "string" ) {
					ops.push( { op: "passthrough", from: entry } );
				} else if ( isObject( entry ) ) {
					for ( const [ from, to ] of Object.entries( entry ) ) {
						typeof to === "string" || fail( `${ where }: passthrough destination for "${ from }" must be a string` );
						ops.push( { op: "passthrough", from, to } );
					}
				} else {
					fail( `${ where }: passthrough entries must be paths or { from: to } objects` );
				}
			}
			for ( const path of list( part.watch ) ) {
				typeof path === "string" || fail( `${ where }: watch must be a path or an array of paths` );
				ops.push( { op: "watch", path } );
			}
			hooks( "beforeBuild", part.beforeBuild, where );
			hooks( "afterBuild", part.afterBuild, where );

			const plugins = list( part.plugins );
			for ( let i = 0; i < plugins.length; i++ ) {
				const plugin = plugins[i];
				const label = plugin?.name ? `plugin "${ plugin.name }"` : `plugins[${ i }]`;
				await apply( plugin, top ? label : `${ where } > ${ label }`, false );
			}
		}

		return { apply, ops, settings };
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

		async run( module, env, serving, file ) {
			"default" in module || fail( `${ file } needs a default export: export default defineConfig({ ... })` );
			const { apply, ops, settings } = await collect( env, serving );
			await apply( module.default, file, true );
			return { ops, settings };
		}
	};
} )();
