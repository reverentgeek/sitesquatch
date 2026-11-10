// The parts of Node's built-in modules that site configs, data files and
// npm packages use: `fs` (sync and promise APIs), `path` (POSIX), `url`,
// `process`, `Buffer`, `util`, `events`, `os`, `assert`, timers, and
// CommonJS `require`. Runs after the prelude; file access goes through
// `native`.
( () => {
	const native = globalThis.__ssqch_native;
	delete globalThis.__ssqch_native;

	// Native errors arrive as "ENOENT: no such file or directory, open 'x'".
	// Node leaves its own ERR_* codes out of the message.
	const nodeError = e => {
		const message = e && e.message || String( e );
		const code = /^([A-Z_]+): /.exec( message );
		const err = new Error( code && code[1].startsWith( "ERR_" ) ? message.slice( code[0].length ) : message );
		if ( code ) err.code = code[1];
		return err;
	};
	const call = ( fn, ...args ) => {
		try {
			return fn( ...args );
		} catch ( e ) {
			throw nodeError( e );
		}
	};
	const pathArg = p => {
		if ( p && typeof p === "object" && typeof p.href === "string" ) return url.fileURLToPath( p );
		if ( typeof p !== "string" ) throw new TypeError( `The "path" argument must be a string or a file URL, got ${ typeof p }` );
		return p;
	};
	const encodingOf = options => typeof options === "string" ? options : options && options.encoding || null;

	// ---- Buffer: a Uint8Array with Node's string conversions.
	class Buffer extends Uint8Array {
		static from( value, encodingOrOffset, length ) {
			if ( typeof value === "string" ) return asBuffer( native.encode( value, encodingOrOffset || "utf8" ) );
			if ( value instanceof ArrayBuffer ) return new Buffer( value, encodingOrOffset || 0, length ?? value.byteLength - ( encodingOrOffset || 0 ) );
			if ( value && value.type === "Buffer" && Array.isArray( value.data ) ) return asBuffer( Uint8Array.from( value.data ) );
			return asBuffer( Uint8Array.from( value ) );
		}
		static alloc( size, fill = 0 ) {
			return new Buffer( size ).fill( fill );
		}
		static isBuffer( value ) {
			return value instanceof Buffer;
		}
		static byteLength( value, encoding = "utf8" ) {
			return typeof value === "string" ? native.encode( value, encoding ).length : value.byteLength;
		}
		static concat( list, total ) {
			const size = total ?? list.reduce( ( n, b ) => n + b.length, 0 );
			const out = new Buffer( size );
			let offset = 0;
			for ( const b of list ) {
				out.set( b.subarray( 0, Math.min( b.length, size - offset ) ), offset );
				offset += b.length;
				if ( offset >= size ) break;
			}
			return out;
		}
		toString( encoding = "utf8", start = 0, end = this.length ) {
			return native.decode( this.subarray( start, end ), encoding );
		}
		toJSON() {
			return { type: "Buffer", data: Array.from( this ) };
		}
		equals( other ) {
			return this.length === other.length && this.every( ( b, i ) => b === other[i] );
		}
	}
	const asBuffer = bytes => Object.setPrototypeOf( bytes, Buffer.prototype );
	globalThis.Buffer = Buffer;

	// ---- path (POSIX)
	const normalizeParts = ( parts, allowAboveRoot ) => {
		const out = [];
		for ( const part of parts ) {
			if ( !part || part === "." ) continue;
			if ( part === ".." ) {
				if ( out.length && out[out.length - 1] !== ".." ) out.pop();
				else if ( allowAboveRoot ) out.push( ".." );
			} else {
				out.push( part );
			}
		}
		return out;
	};
	const needString = ( name, value ) => {
		if ( typeof value !== "string" ) throw new TypeError( `The "${ name }" argument must be of type string. Received ${ typeof value }` );
	};
	const trimTrailing = p => p.length > 1 ? p.replace( /\/+$/, "" ) || "/" : p;

	// POSIX rules, plus Windows drive paths (C:/site, C:\\site) count as absolute.
	const absolute = p => p.startsWith( "/" ) || /^[A-Za-z]:[\\/]/.test( p );

	const path = {
		sep: "/",
		delimiter: ":",
		normalize( p ) {
			needString( "path", p );
			if ( p === "" ) return ".";
			const absolute = p.startsWith( "/" );
			const trailing = p.endsWith( "/" );
			let out = normalizeParts( p.split( "/" ), !absolute ).join( "/" );
			if ( !out && !absolute ) out = ".";
			if ( out && trailing ) out += "/";
			return ( absolute ? "/" : "" ) + out;
		},
		join( ...parts ) {
			parts.forEach( p => needString( "path", p ) );
			const joined = parts.filter( p => p !== "" ).join( "/" );
			return joined ? path.normalize( joined ) : ".";
		},
		resolve( ...parts ) {
			let resolved = "";
			for ( let i = parts.length - 1; i >= -1 && !absolute( resolved ); i-- ) {
				const part = i >= 0 ? parts[i] : process.cwd();
				needString( "path", part );
				if ( part ) resolved = resolved ? `${ part }/${ resolved }` : part;
			}
			return trimTrailing( path.normalize( resolved ) );
		},
		isAbsolute( p ) {
			needString( "path", p );
			return absolute( p );
		},
		// dirname, basename, extname and parse follow Node's rules, including
		// the edge cases: "a//b" -> "a/", ".." has no extension.
		dirname( p ) {
			needString( "path", p );
			if ( !p ) return ".";
			const absolute = p.startsWith( "/" );
			let end = -1;
			let matchedSlash = true;
			for ( let i = p.length - 1; i >= 1; i-- ) {
				if ( p[i] === "/" ) {
					if ( !matchedSlash ) {
						end = i;
						break;
					}
				} else {
					matchedSlash = false;
				}
			}
			if ( end === -1 ) return absolute ? "/" : ".";
			if ( absolute && end === 1 ) return "//";
			return p.slice( 0, end );
		},
		basename( p, ext ) {
			needString( "path", p );
			const trimmed = trimTrailing( p );
			const base = trimmed === "/" ? "" : trimmed.slice( trimmed.lastIndexOf( "/" ) + 1 );
			if ( typeof ext !== "string" || !ext || !base.endsWith( ext ) ) return base;
			// Node keeps a name that is entirely the suffix, unless the path has no slash.
			if ( base === ext ) return p.includes( "/" ) ? base : "";
			return base.slice( 0, -ext.length );
		},
		extname( p ) {
			const base = path.basename( p );
			const i = base.lastIndexOf( "." );
			if ( i <= 0 || base === ".." ) return "";
			return base.slice( i );
		},
		relative( from, to ) {
			const a = path.resolve( from ).split( "/" ).filter( Boolean );
			const b = path.resolve( to ).split( "/" ).filter( Boolean );
			let i = 0;
			while ( i < a.length && i < b.length && a[i] === b[i] ) i++;
			return [ ...Array( a.length - i ).fill( ".." ), ...b.slice( i ) ].join( "/" );
		},
		parse( p ) {
			needString( "path", p );
			const root = p.startsWith( "/" ) ? "/" : "";
			const base = path.basename( p );
			const ext = path.extname( p );
			const trimmed = trimTrailing( p );
			const i = trimmed.lastIndexOf( "/" );
			const dir = i === -1 ? "" : i === 0 ? "/" : trimmed.slice( 0, i );
			return { root, dir, base, ext, name: ext ? base.slice( 0, -ext.length ) : base };
		},
		format( { root = "", dir = "", base, name = "", ext = "" } ) {
			const file = base || name + ext;
			if ( !dir ) return root + file;
			return dir === root ? dir + file : `${ dir }/${ file }`;
		},
		toNamespacedPath: p => p
	};
	path.posix = path;

	// ---- url
	// ---- URL and URLSearchParams (WHATWG). Parsing and setters run in Rust.
	const paramLists = new WeakMap();
	const paramOwners = new WeakMap();
	const formDecode = s => {
		const text = s.replace( /\+/g, " " );
		try {
			return decodeURIComponent( text );
		} catch {
			return text.replace( /%([0-9A-Fa-f]{2})/g, ( m, h ) => String.fromCharCode( parseInt( h, 16 ) ) );
		}
	};
	const formEncode = s => encodeURIComponent( s ).replace( /%20/g, "+" ).replace( /[!'()~]/g, c => "%" + c.charCodeAt( 0 ).toString( 16 ).toUpperCase() );
	const parseQuery = s => {
		const list = [];
		for ( const part of String( s ).replace( /^\?/, "" ).split( "&" ) ) {
			if ( !part ) continue;
			const eq = part.indexOf( "=" );
			list.push( eq < 0 ? [ formDecode( part ), "" ] : [ formDecode( part.slice( 0, eq ) ), formDecode( part.slice( eq + 1 ) ) ] );
		}
		return list;
	};
	class URLSearchParams {
		constructor( init = "" ) {
			let list = [];
			if ( init instanceof URLSearchParams ) list = paramLists.get( init ).map( p => [ ...p ] );
			else if ( init !== null && typeof init === "object" && typeof init[Symbol.iterator] === "function" ) {
				for ( const pair of init ) {
					const [ k, v, ...rest ] = [ ...pair ];
					if ( rest.length || v === undefined ) throw new TypeError( "Each query pair must be an iterable [name, value] tuple" );
					list.push( [ String( k ), String( v ) ] );
				}
			} else if ( init !== null && typeof init === "object" ) list = Object.keys( init ).map( k => [ k, String( init[k] ) ] );
			else list = parseQuery( init );
			paramLists.set( this, list );
		}
		#changed() {
			const owner = paramOwners.get( this );
			if ( owner ) owner( this.toString() );
		}
		get size() {
			return paramLists.get( this ).length;
		}
		append( name, value ) {
			paramLists.get( this ).push( [ String( name ), String( value ) ] );
			this.#changed();
		}
		delete( name, value ) {
			name = String( name );
			paramLists.set( this, paramLists.get( this ).filter( ( [ k, v ] ) => k !== name || value !== undefined && v !== String( value ) ) );
			this.#changed();
		}
		get( name ) {
			const found = paramLists.get( this ).find( ( [ k ] ) => k === String( name ) );
			return found ? found[1] : null;
		}
		getAll( name ) {
			return paramLists.get( this ).filter( ( [ k ] ) => k === String( name ) ).map( ( [ , v ] ) => v );
		}
		has( name, value ) {
			return paramLists.get( this ).some( ( [ k, v ] ) => k === String( name ) && ( value === undefined || v === String( value ) ) );
		}
		set( name, value ) {
			name = String( name );
			const list = paramLists.get( this );
			const i = list.findIndex( ( [ k ] ) => k === name );
			if ( i < 0 ) list.push( [ name, String( value ) ] );
			else {
				list[i] = [ name, String( value ) ];
				paramLists.set( this, list.filter( ( [ k ], j ) => j <= i || k !== name ) );
			}
			this.#changed();
		}
		sort() {
			const list = paramLists.get( this );
			list.sort( ( [ a ], [ b ] ) => a < b ? -1 : a > b ? 1 : 0 );
			this.#changed();
		}
		forEach( fn, thisArg ) {
			for ( const [ k, v ] of paramLists.get( this ) ) fn.call( thisArg, v, k, this );
		}
		*entries() {
			for ( const [ k, v ] of paramLists.get( this ) ) yield [ k, v ];
		}
		*keys() {
			for ( const [ k ] of paramLists.get( this ) ) yield k;
		}
		*values() {
			for ( const [ , v ] of paramLists.get( this ) ) yield v;
		}
		[Symbol.iterator]() {
			return this.entries();
		}
		toString() {
			return paramLists.get( this ).map( ( [ k, v ] ) => `${ formEncode( k ) }=${ formEncode( v ) }` ).join( "&" );
		}
		get [Symbol.toStringTag]() {
			return "URLSearchParams";
		}
	}
	class URL {
		#parts;
		#params = null;
		constructor( input, base ) {
			const href = input instanceof URL ? input.href : String( input );
			this.#parts = base === undefined ? native.urlParse( href ) : native.urlParse( href, base instanceof URL ? base.href : String( base ) );
		}
		static canParse( input, base ) {
			try {
				new URL( input, base );
				return true;
			} catch {
				return false;
			}
		}
		static parse( input, base ) {
			try {
				return new URL( input, base );
			} catch {
				return null;
			}
		}
		#set( part, value ) {
			this.#parts = native.urlSet( this.#parts.href, part, String( value ) );
			if ( this.#params && ( part === "href" || part === "search" ) ) paramLists.set( this.#params, parseQuery( this.#parts.search ) );
		}
		get href() { return this.#parts.href; }
		set href( v ) { this.#set( "href", v ); }
		get origin() { return this.#parts.origin; }
		get protocol() { return this.#parts.protocol; }
		set protocol( v ) { this.#set( "protocol", v ); }
		get username() { return this.#parts.username; }
		set username( v ) { this.#set( "username", v ); }
		get password() { return this.#parts.password; }
		set password( v ) { this.#set( "password", v ); }
		get host() { return this.#parts.host; }
		set host( v ) { this.#set( "host", v ); }
		get hostname() { return this.#parts.hostname; }
		set hostname( v ) { this.#set( "hostname", v ); }
		get port() { return this.#parts.port; }
		set port( v ) { this.#set( "port", v ); }
		get pathname() { return this.#parts.pathname; }
		set pathname( v ) { this.#set( "pathname", v ); }
		get search() { return this.#parts.search; }
		set search( v ) { this.#set( "search", v ); }
		get hash() { return this.#parts.hash; }
		set hash( v ) { this.#set( "hash", v ); }
		get searchParams() {
			if ( !this.#params ) {
				this.#params = new URLSearchParams( this.#parts.search );
				paramOwners.set( this.#params, query => {
					this.#parts = native.urlSet( this.#parts.href, "search", query );
				} );
			}
			return this.#params;
		}
		toString() {
			return this.#parts.href;
		}
		toJSON() {
			return this.#parts.href;
		}
		get [Symbol.toStringTag]() {
			return "URL";
		}
	}
	globalThis.URL = URL;
	globalThis.URLSearchParams = URLSearchParams;

	const url = {
		fileURLToPath( value ) {
			const href = typeof value === "string" ? value : value && value.href;
			if ( typeof href !== "string" || !href.startsWith( "file:" ) ) throw new TypeError( "The URL must be of scheme file" );
			const rest = href.slice( "file:".length ).replace( /^\/\/(localhost)?/, "" );
			const decoded = decodeURIComponent( rest.split( /[?#]/ )[0] );
			// file:///C:/site -> C:/site on Windows.
			return /^\/[A-Za-z]:\//.test( decoded ) ? decoded.slice( 1 ) : decoded;
		},
		pathToFileURL( p ) {
			const resolved = path.resolve( pathArg( p ) );
			const encoded = encodeURI( resolved ).replace( /[?#]/g, encodeURIComponent );
			return new URL( "file://" + ( resolved.startsWith( "/" ) ? "" : "/" ) + encoded );
		},
		// The legacy API, for older packages.
		parse( text, parseQuery ) {
			let u;
			const absolute = /^[a-z][a-z0-9+.-]*:/i.test( text );
			try {
				u = absolute ? new URL( text ) : new URL( text, "http://relative.invalid" );
			} catch {
				return { href: text, path: text, pathname: text, protocol: null, host: null, hostname: null, port: null, search: null, query: parseQuery ? {} : null, hash: null };
			}
			const own = v => absolute ? v || null : null;
			const query = u.search ? u.search.slice( 1 ) : null;
			return {
				protocol: own( u.protocol ),
				slashes: absolute ? /^[a-z][a-z0-9+.-]*:\/\//i.test( text ) : null,
				auth: absolute && u.username ? decodeURIComponent( u.username ) + ( u.password ? ":" + decodeURIComponent( u.password ) : "" ) : null,
				host: own( u.host ),
				port: own( u.port ),
				hostname: own( u.hostname ),
				hash: u.hash || null,
				search: u.search || null,
				query: parseQuery ? Object.fromEntries( new URLSearchParams( u.search ) ) : query,
				pathname: absolute || text.startsWith( "/" ) ? u.pathname : u.pathname.slice( 1 ),
				path: ( absolute || text.startsWith( "/" ) ? u.pathname : u.pathname.slice( 1 ) ) + u.search,
				href: absolute ? u.href : text
			};
		},
		format( u ) {
			if ( typeof u === "string" ) return u;
			if ( u instanceof URL ) return u.href;
			const auth = u.auth ? u.auth + "@" : "";
			const host = u.host || ( u.hostname ? u.hostname + ( u.port ? ":" + u.port : "" ) : "" );
			const protocol = u.protocol ? u.protocol.replace( /:?$/, ":" ) : "";
			const slashes = u.slashes || host || /^(https?|ftp|file|wss?):$/.test( protocol ) ? "//" : "";
			const search = u.search || ( u.query && typeof u.query === "object" ? "?" + new URLSearchParams( u.query ) : u.query ? "?" + u.query : "" );
			const hash = u.hash ? ( u.hash.startsWith( "#" ) ? u.hash : "#" + u.hash ) : "";
			return protocol + slashes + auth + host + ( u.pathname || "" ) + ( search === "?" ? "" : search ) + hash;
		},
		resolve: ( from, to ) => {
			const resolved = new URL( to, new URL( from, "resolve://" ) );
			return resolved.protocol === "resolve:" ? resolved.pathname + resolved.search + resolved.hash : resolved.href;
		},
		URLSearchParams
	};
	url.URL = URL;

	// ---- fs
	const toStats = s => s && {
		...s,
		mtime: new Date( s.mtimeMs ),
		atime: new Date( s.atimeMs ),
		ctime: new Date( s.ctimeMs ),
		birthtime: new Date( s.birthtimeMs ),
		isFile: () => s.file,
		isDirectory: () => s.dir,
		isSymbolicLink: () => s.symlink
	};
	const fs = {
		readFileSync( p, options ) {
			const encoding = encodingOf( options );
			const out = call( native.readFile, pathArg( p ), encoding || "" );
			return encoding ? out : asBuffer( out );
		},
		writeFileSync( p, data, options ) {
			call( native.writeFile, pathArg( p ), typeof data === "string" ? data : Uint8Array.from( data ), encodingOf( options ) || "utf8", false );
		},
		appendFileSync( p, data, options ) {
			call( native.writeFile, pathArg( p ), typeof data === "string" ? data : Uint8Array.from( data ), encodingOf( options ) || "utf8", true );
		},
		existsSync( p ) {
			try {
				return native.exists( pathArg( p ) );
			} catch {
				return false;
			}
		},
		accessSync( p ) {
			if ( !fs.existsSync( p ) ) throw nodeError( new Error( `ENOENT: no such file or directory, access '${ p }'` ) );
		},
		statSync( p, options = {} ) {
			try {
				return toStats( native.stat( pathArg( p ), true ) );
			} catch ( e ) {
				const err = nodeError( e );
				if ( options.throwIfNoEntry === false && err.code === "ENOENT" ) return undefined;
				throw err;
			}
		},
		lstatSync( p ) {
			return toStats( call( native.stat, pathArg( p ), false ) );
		},
		readdirSync( p, options = {} ) {
			const entries = call( native.readdir, pathArg( p ) );
			if ( !options.withFileTypes ) return entries.map( e => e.name );
			return entries.map( e => ( { name: e.name, parentPath: pathArg( p ), path: pathArg( p ), isFile: () => e.file, isDirectory: () => e.dir, isSymbolicLink: () => e.symlink } ) );
		},
		mkdirSync( p, options = {} ) {
			call( native.mkdir, pathArg( p ), Boolean( options.recursive ) );
		},
		rmSync( p, options = {} ) {
			call( native.rm, pathArg( p ), Boolean( options.recursive ), Boolean( options.force ) );
		},
		unlinkSync( p ) {
			call( native.unlink, pathArg( p ) );
		},
		renameSync( from, to ) {
			call( native.rename, pathArg( from ), pathArg( to ) );
		},
		copyFileSync( from, to ) {
			call( native.copyFile, pathArg( from ), pathArg( to ) );
		},
		realpathSync( p ) {
			return call( native.realpath, pathArg( p ) );
		}
	};
	const promises = {};
	for ( const [ name, sync ] of Object.entries( fs ) ) {
		if ( name === "existsSync" ) continue;
		promises[name.replace( /Sync$/, "" )] = async ( ...args ) => sync( ...args );
	}
	promises.access = async p => fs.accessSync( p );
	fs.promises = promises;
	fs.constants = { F_OK: 0, R_OK: 4, W_OK: 2, X_OK: 1 };

	// ---- crypto: hashing (createHash), computed in Rust.
	const HASHES = [ "md5", "sha1", "sha256", "sha384", "sha512" ];
	class Hash {
		#algorithm;
		#chunks = [];
		#done = false;
		constructor( algorithm ) {
			if ( !HASHES.includes( String( algorithm ).toLowerCase() ) ) {
				throw new Error( `Digest method not supported: ${ algorithm } (ssqch supports ${ HASHES.join( ", " ) })` );
			}
			this.#algorithm = String( algorithm ).toLowerCase();
		}
		update( data, encoding ) {
			if ( this.#done ) throw new Error( "Digest already called" );
			this.#chunks.push( typeof data === "string" ? Buffer.from( data, encoding || "utf8" ) : Buffer.from( data ) );
			return this;
		}
		digest( encoding ) {
			if ( this.#done ) throw new Error( "Digest already called" );
			this.#done = true;
			const out = asBuffer( native.hash( this.#algorithm, Buffer.concat( this.#chunks ) ) );
			return encoding ? out.toString( encoding ) : out;
		}
	}
	const crypto = {
		createHash: algorithm => new Hash( algorithm ),
		getHashes: () => [ ...HASHES ]
	};

	// ---- timers: run by `wait` (below, called from Rust) when a promise is
	// waiting and no other work is left, like Node's event loop. They wait
	// for real.
	const timers = new Map();
	let timerIds = 0;
	class Timeout {
		#id;
		constructor( id ) {
			this.#id = id;
		}
		ref() {
			const t = timers.get( this.#id );
			if ( t ) t.ref = true;
			return this;
		}
		unref() {
			const t = timers.get( this.#id );
			if ( t ) t.ref = false;
			return this;
		}
		hasRef() {
			return Boolean( timers.get( this.#id )?.ref );
		}
		refresh() {
			const t = timers.get( this.#id );
			if ( t ) t.due = Date.now() + t.delay;
			return this;
		}
		close() {
			timers.delete( this.#id );
			return this;
		}
		[Symbol.toPrimitive]() {
			return this.#id;
		}
	}
	const addTimer = ( fn, delay, args, repeat ) => {
		if ( typeof fn !== "function" ) throw new TypeError( `The "callback" argument must be of type function. Received ${ typeof fn }` );
		delay = Math.max( 1, Number( delay ) || 0 );
		const id = ++timerIds;
		timers.set( id, { id, fn, args, delay, repeat, due: Date.now() + delay, ref: true, seq: id } );
		return new Timeout( id );
	};
	const clearTimer = t => {
		if ( t !== null && t !== undefined ) timers.delete( Number( t ) );
	};
	const timerFns = {
		setTimeout: ( fn, delay, ...args ) => addTimer( fn, delay, args, false ),
		setInterval: ( fn, delay, ...args ) => addTimer( fn, delay, args, true ),
		setImmediate: ( fn, ...args ) => addTimer( fn, 0, args, false ),
		clearTimeout: clearTimer,
		clearInterval: clearTimer,
		clearImmediate: clearTimer
	};
	Object.assign( globalThis, timerFns );
	// What `fetch()` is waiting for: request id to its promise's callbacks.
	const pendingFetches = new Map();
	// Called from Rust when a promise is waiting and no other work is left:
	// waits for the next finished request or due timer, and runs it. False
	// when nothing could ever run (unref'd timers alone don't count).
	globalThis.__ssqch.wait = () => {
		let next = null;
		let alive = pendingFetches.size > 0;
		for ( const t of timers.values() ) {
			alive ||= t.ref;
			if ( !next || t.due < next.due || ( t.due === next.due && t.seq < next.seq ) ) next = t;
		}
		if ( !alive ) return false;
		if ( pendingFetches.size ) {
			const done = native.fetchWait( next ? Math.max( 0, next.due - Date.now() ) : -1 );
			if ( done ) {
				const pending = pendingFetches.get( done.id );
				pendingFetches.delete( done.id );
				if ( pending ) pending( done );
				return true;
			}
		} else {
			native.sleep( next.due - Date.now() );
		}
		if ( next.repeat ) {
			next.due = Math.max( Date.now(), next.due + next.delay );
			next.seq = ++timerIds;
		} else {
			timers.delete( next.id );
		}
		next.fn( ...next.args );
		return true;
	};
	const timersPromises = {
		setTimeout: ( delay, value ) => new Promise( resolve => addTimer( resolve, delay, [ value ], false ) ),
		setImmediate: value => new Promise( resolve => addTimer( resolve, 0, [ value ], false ) ),
		scheduler: { wait: delay => new Promise( resolve => addTimer( resolve, delay, [], false ) ) }
	};
	globalThis.global = globalThis;
	process.nextTick = ( fn, ...args ) => queueMicrotask( () => fn( ...args ) );
	process.argv ??= [ "ssqch" ];
	process.versions ??= {};
	process.version ??= "";
	process.exitCode = undefined;
	process.stdout ??= { write: s => ( console.log( String( s ).replace( /\n$/, "" ) ), true ), isTTY: false };
	process.stderr ??= { write: s => ( console.error( String( s ).replace( /\n$/, "" ) ), true ), isTTY: false };
	process.emitWarning ??= ( warning ) => console.warn( `Warning: ${ warning && warning.message || warning }` );
	process.on ??= () => process;
	process.once ??= () => process;
	process.off ??= () => process;
	const now = () => typeof performance === "object" ? performance.now() : Date.now();
	process.hrtime ??= Object.assign( ( prev ) => {
		const ns = BigInt( Math.round( now() * 1e6 ) );
		const now = [ Number( ns / 1000000000n ), Number( ns % 1000000000n ) ];
		if ( !prev ) return now;
		let s = now[0] - prev[0], n = now[1] - prev[1];
		if ( n < 0 ) {
			s -= 1;
			n += 1e9;
		}
		return [ s, n ];
	}, { bigint: () => BigInt( Math.round( now() * 1e6 ) ) } );

	// ---- TextEncoder, TextDecoder and EventTarget, which QuickJS lacks.
	globalThis.TextEncoder ??= class TextEncoder {
		get encoding() {
			return "utf-8";
		}
		encode( text = "" ) {
			return new Uint8Array( native.encode( String( text ), "utf8" ) );
		}
	};
	globalThis.TextDecoder ??= class TextDecoder {
		#encoding;
		constructor( encoding = "utf-8" ) {
			const name = String( encoding ).toLowerCase();
			if ( ![ "utf-8", "utf8", "unicode-1-1-utf-8", "latin1", "iso-8859-1", "ascii" ].includes( name ) ) throw new RangeError( `The "${ encoding }" encoding is not supported` );
			this.#encoding = name;
		}
		get encoding() {
			return this.#encoding.startsWith( "u" ) ? "utf-8" : this.#encoding;
		}
		decode( bytes ) {
			if ( bytes === undefined ) return "";
			const view = bytes instanceof ArrayBuffer ? new Uint8Array( bytes ) : new Uint8Array( bytes.buffer, bytes.byteOffset, bytes.byteLength );
			const encoding = { "utf-8": "utf8", utf8: "utf8", "unicode-1-1-utf-8": "utf8", "iso-8859-1": "latin1", ascii: "latin1" }[this.#encoding] ?? this.#encoding;
			const text = native.decode( view, encoding.replace( "-", "" ) );
			return text.charCodeAt( 0 ) === 0xfeff ? text.slice( 1 ) : text;
		}
	};
	globalThis.Event ??= class Event {
		constructor( type, options = {} ) {
			this.type = String( type );
			this.bubbles = Boolean( options.bubbles );
			this.cancelable = Boolean( options.cancelable );
			this.defaultPrevented = false;
			this.timeStamp = Date.now();
		}
		preventDefault() {
			if ( this.cancelable ) this.defaultPrevented = true;
		}
		stopPropagation() {}
		stopImmediatePropagation() {}
	};
	const eventListeners = new WeakMap();
	globalThis.EventTarget ??= class EventTarget {
		addEventListener( type, listener, options ) {
			if ( !listener ) return;
			if ( !eventListeners.has( this ) ) eventListeners.set( this, [] );
			const list = eventListeners.get( this );
			if ( !list.some( l => l.type === type && l.listener === listener ) ) list.push( { type, listener, once: Boolean( options && options.once ) } );
		}
		removeEventListener( type, listener ) {
			const list = eventListeners.get( this );
			if ( list ) eventListeners.set( this, list.filter( l => l.type !== type || l.listener !== listener ) );
		}
		dispatchEvent( event ) {
			for ( const l of [ ...( eventListeners.get( this ) || [] ) ] ) {
				if ( l.type !== event.type ) continue;
				if ( l.once ) this.removeEventListener( l.type, l.listener );
				typeof l.listener === "function" ? l.listener.call( this, event ) : l.listener.handleEvent( event );
			}
			return !event.defaultPrevented;
		}
	};

	// ---- util
	const inspect = ( value, options = {} ) => {
		const seen = new Set();
		const depthLimit = options.depth === undefined ? 2 : options.depth === null ? Infinity : options.depth;
		const show = ( v, depth ) => {
			if ( typeof v === "string" ) return depth < 0 ? v : `'${ v.replace( /'/g, "\\'" ) }'`;
			if ( typeof v === "function" ) return `[Function: ${ v.name || "(anonymous)" }]`;
			if ( typeof v === "bigint" ) return `${ v }n`;
			if ( v === null || typeof v !== "object" ) return String( v );
			if ( v instanceof Date ) return v.toISOString();
			if ( v instanceof RegExp ) return String( v );
			if ( v instanceof Error ) return v.stack ? `${ v.stack }` : `${ v.name }: ${ v.message }`;
			if ( seen.has( v ) ) return "[Circular *1]";
			if ( depth > depthLimit ) return Array.isArray( v ) ? "[Array]" : "[Object]";
			seen.add( v );
			let out;
			if ( Array.isArray( v ) ) {
				out = v.length ? `[ ${ v.map( x => show( x, depth + 1 ) ).join( ", " ) } ]` : "[]";
			} else if ( v instanceof Map ) {
				out = `Map(${ v.size }) { ${ [ ...v ].map( ( [ k, x ] ) => `${ show( k, depth + 1 ) } => ${ show( x, depth + 1 ) }` ).join( ", " ) } }`;
			} else if ( v instanceof Set ) {
				out = `Set(${ v.size }) { ${ [ ...v ].map( x => show( x, depth + 1 ) ).join( ", " ) } }`;
			} else {
				const keys = Object.keys( v );
				const body = keys.map( k => `${ /^[A-Za-z_$][\w$]*$/.test( k ) ? k : `'${ k }'` }: ${ show( v[k], depth + 1 ) }` ).join( ", " );
				out = keys.length ? `{ ${ body } }` : "{}";
			}
			seen.delete( v );
			return out;
		};
		// Top-level strings print as they are.
		return show( value, typeof value === "string" ? -1 : 0 );
	};
	const format = ( first, ...args ) => {
		if ( typeof first !== "string" ) return [ first, ...args ].map( v => inspect( v ) ).join( " " );
		let i = 0;
		const out = first.replace( /%([sdifjoOc%])/g, ( m, f ) => {
			if ( f === "%" ) return "%";
			if ( i >= args.length ) return m;
			const v = args[i++];
			switch ( f ) {
				case "s": return typeof v === "string" ? v : inspect( v );
				case "d": case "i": return String( f === "i" ? parseInt( v ) : Number( v ) );
				case "f": return String( parseFloat( v ) );
				case "j": try { return JSON.stringify( v ); } catch { return "[Circular]"; }
				case "c": return "";
				default: return inspect( v );
			}
		} );
		return [ out, ...args.slice( i ).map( v => typeof v === "string" ? v : inspect( v ) ) ].join( " " );
	};
	const isDeepStrictEqual = ( a, b ) => {
		if ( Object.is( a, b ) ) return true;
		if ( typeof a !== "object" || typeof b !== "object" || a === null || b === null ) return false;
		if ( Object.getPrototypeOf( a ) !== Object.getPrototypeOf( b ) ) return false;
		if ( a instanceof Date ) return a.getTime() === b.getTime();
		if ( a instanceof RegExp ) return String( a ) === String( b );
		if ( a instanceof Map || a instanceof Set ) return isDeepStrictEqual( [ ...a ], [ ...b ] );
		const ka = Object.keys( a ), kb = Object.keys( b );
		return ka.length === kb.length && ka.every( k => Object.prototype.hasOwnProperty.call( b, k ) && isDeepStrictEqual( a[k], b[k] ) );
	};
	const warned = new Set();
	const util = {
		format,
		inspect: Object.assign( inspect, { custom: Symbol.for( "nodejs.util.inspect.custom" ), defaultOptions: {} } ),
		isDeepStrictEqual,
		promisify: fn => {
			if ( typeof fn[util.promisify.custom] === "function" ) return fn[util.promisify.custom];
			return ( ...args ) => new Promise( ( resolve, reject ) => fn( ...args, ( err, value ) => err ? reject( err ) : resolve( value ) ) );
		},
		callbackify: fn => ( ...args ) => {
			const done = args.pop();
			fn( ...args ).then( v => done( null, v ), e => done( e ) );
		},
		inherits( ctor, superCtor ) {
			Object.defineProperty( ctor, "super_", { value: superCtor, writable: true, configurable: true } );
			Object.setPrototypeOf( ctor.prototype, superCtor.prototype );
		},
		deprecate: ( fn, message, code ) => function ( ...args ) {
			const key = code || message;
			if ( !warned.has( key ) ) {
				warned.add( key );
				console.warn( `DeprecationWarning: ${ message }` );
			}
			return new.target ? Reflect.construct( fn, args, new.target ) : fn.apply( this, args );
		},
		debuglog: () => Object.assign( () => {}, { enabled: false } ),
		isArray: Array.isArray,
		types: {
			isDate: v => v instanceof Date,
			isRegExp: v => v instanceof RegExp,
			isPromise: v => v instanceof Promise,
			isMap: v => v instanceof Map,
			isSet: v => v instanceof Set,
			isNativeError: v => v instanceof Error,
			isTypedArray: v => ArrayBuffer.isView( v ) && !( v instanceof DataView ),
			isUint8Array: v => v instanceof Uint8Array,
			isArrayBuffer: v => v instanceof ArrayBuffer,
			isAsyncFunction: v => typeof v === "function" && v.constructor && v.constructor.name === "AsyncFunction",
			isGeneratorFunction: v => typeof v === "function" && v.constructor && /GeneratorFunction$/.test( v.constructor.name )
		},
		TextEncoder: globalThis.TextEncoder,
		TextDecoder: globalThis.TextDecoder
	};
	util.promisify.custom = Symbol.for( "nodejs.util.promisify.custom" );

	// ---- events. A function, not a class: older packages inherit with
	// `EventEmitter.call(this)` and `util.inherits`.
	function EventEmitter() {
		EventEmitter.init.call( this );
	}
	EventEmitter.defaultMaxListeners = 10;
	EventEmitter.init = function () {
		if ( !this._events || this._events === Object.getPrototypeOf( this )._events ) this._events = Object.create( null );
		this._maxListeners ??= undefined;
	};
	const eventsOf = emitter => {
		if ( !emitter._events ) emitter._events = Object.create( null );
		return emitter._events;
	};
	const addListener = ( emitter, name, listener, prepend ) => {
		if ( typeof listener !== "function" ) throw new TypeError( `The "listener" argument must be of type function. Received ${ typeof listener }` );
		const events = eventsOf( emitter );
		if ( events.newListener && name !== "newListener" ) emitter.emit( "newListener", name, listener.listener ?? listener );
		const list = events[name] ||= [];
		prepend ? list.unshift( listener ) : list.push( listener );
		return emitter;
	};
	const onceWrapper = ( emitter, name, listener ) => {
		const wrapper = ( ...args ) => {
			emitter.removeListener( name, wrapper );
			return listener.apply( emitter, args );
		};
		wrapper.listener = listener;
		return wrapper;
	};
	Object.assign( EventEmitter.prototype, {
		on( name, listener ) {
			return addListener( this, name, listener, false );
		},
		addListener( name, listener ) {
			return addListener( this, name, listener, false );
		},
		prependListener( name, listener ) {
			return addListener( this, name, listener, true );
		},
		once( name, listener ) {
			return addListener( this, name, onceWrapper( this, name, listener ), false );
		},
		prependOnceListener( name, listener ) {
			return addListener( this, name, onceWrapper( this, name, listener ), true );
		},
		removeListener( name, listener ) {
			const events = eventsOf( this );
			const list = events[name];
			if ( !list ) return this;
			const i = list.findIndex( l => l === listener || l.listener === listener );
			if ( i >= 0 ) list.splice( i, 1 );
			if ( !list.length ) delete events[name];
			return this;
		},
		off( name, listener ) {
			return this.removeListener( name, listener );
		},
		removeAllListeners( name ) {
			if ( name === undefined ) this._events = Object.create( null );
			else delete eventsOf( this )[name];
			return this;
		},
		emit( name, ...args ) {
			const list = eventsOf( this )[name];
			if ( !list || !list.length ) {
				if ( name === "error" ) throw args[0] instanceof Error ? args[0] : new Error( `Unhandled error. (${ inspect( args[0] ) })` );
				return false;
			}
			for ( const listener of [ ...list ] ) listener.apply( this, args );
			return true;
		},
		listeners( name ) {
			return ( eventsOf( this )[name] || [] ).map( l => l.listener ?? l );
		},
		rawListeners( name ) {
			return [ ...( eventsOf( this )[name] || [] ) ];
		},
		listenerCount( name ) {
			return ( eventsOf( this )[name] || [] ).length;
		},
		eventNames() {
			return Reflect.ownKeys( eventsOf( this ) );
		},
		setMaxListeners( n ) {
			this._maxListeners = n;
			return this;
		},
		getMaxListeners() {
			return this._maxListeners ?? EventEmitter.defaultMaxListeners;
		}
	} );
	EventEmitter.EventEmitter = EventEmitter;
	EventEmitter.once = ( emitter, name ) => new Promise( ( resolve, reject ) => {
		emitter.once( name, ( ...args ) => resolve( args ) );
		if ( name !== "error" ) emitter.once( "error", reject );
	} );

	// ---- os
	const windows = process.platform === "win32";
	const os = {
		EOL: windows ? "\r\n" : "\n",
		platform: () => process.platform,
		type: () => ( { darwin: "Darwin", win32: "Windows_NT", linux: "Linux" } )[process.platform] || process.platform,
		arch: () => native.arch,
		release: () => "",
		hostname: () => "localhost",
		homedir: () => process.env.HOME || process.env.USERPROFILE || "/",
		tmpdir: () => ( process.env.TMPDIR || process.env.TEMP || process.env.TMP || ( windows ? "C:/Windows/Temp" : "/tmp" ) ).replace( /[\\/]+$/, "" ),
		cpus: () => [],
		availableParallelism: () => 1,
		totalmem: () => 0,
		freemem: () => 0,
		endianness: () => "LE",
		userInfo: () => ( { username: process.env.USER || process.env.USERNAME || "", homedir: os.homedir() } )
	};

	// ---- assert
	class AssertionError extends Error {
		constructor( options ) {
			super( options.message );
			this.name = "AssertionError";
			this.code = "ERR_ASSERTION";
			this.actual = options.actual;
			this.expected = options.expected;
			this.operator = options.operator;
		}
	}
	const check = ( ok, message, actual, expected, operator, fallback ) => {
		if ( ok ) return;
		if ( message instanceof Error ) throw message;
		throw new AssertionError( { message: message ?? fallback(), actual, expected, operator } );
	};
	const assert = ( value, message ) => check( value, message, value, true, "==", () => "The expression evaluated to a falsy value" );
	Object.assign( assert, {
		AssertionError,
		ok: assert,
		equal: ( a, b, m ) => check( a == b, m, a, b, "==", () => `${ inspect( a ) } == ${ inspect( b ) }` ),
		notEqual: ( a, b, m ) => check( a != b, m, a, b, "!=", () => `${ inspect( a ) } != ${ inspect( b ) }` ),
		strictEqual: ( a, b, m ) => check( Object.is( a, b ), m, a, b, "strictEqual", () => `Expected values to be strictly equal:\n\n${ inspect( a ) } !== ${ inspect( b ) }` ),
		notStrictEqual: ( a, b, m ) => check( !Object.is( a, b ), m, a, b, "notStrictEqual", () => `Expected "actual" to be strictly unequal to: ${ inspect( b ) }` ),
		deepEqual: ( a, b, m ) => check( isDeepStrictEqual( a, b ), m, a, b, "deepEqual", () => "Expected values to be loosely deep-equal" ),
		deepStrictEqual: ( a, b, m ) => check( isDeepStrictEqual( a, b ), m, a, b, "deepStrictEqual", () => "Expected values to be strictly deep-equal" ),
		notDeepStrictEqual: ( a, b, m ) => check( !isDeepStrictEqual( a, b ), m, a, b, "notDeepStrictEqual", () => "Expected values not to be strictly deep-equal" ),
		fail: m => check( false, m, undefined, undefined, "fail", () => "Failed" ),
		match: ( s, re, m ) => check( re.test( s ), m, s, re, "match", () => `The input did not match the regular expression ${ re }` ),
		throws( fn, expected, m ) {
			try {
				fn();
			} catch {
				return;
			}
			check( false, typeof expected === "string" ? expected : m, undefined, expected, "throws", () => "Missing expected exception." );
		},
		async rejects( p, expected, m ) {
			try {
				await ( typeof p === "function" ? p() : p );
			} catch {
				return;
			}
			check( false, typeof expected === "string" ? expected : m, undefined, expected, "rejects", () => "Missing expected rejection." );
		}
	} );
	assert.strict = assert;

	// ---- string_decoder
	class StringDecoder {
		constructor( encoding = "utf8" ) {
			this.encoding = encoding;
		}
		write( buffer ) {
			return typeof buffer === "string" ? buffer : Buffer.from( buffer ).toString( this.encoding );
		}
		end( buffer ) {
			return buffer ? this.write( buffer ) : "";
		}
	}


	// ---- fetch: requests run in Rust (fetch.rs) on threads of their own.
	globalThis.DOMException ??= class DOMException extends Error {
		constructor( message = "", name = "Error" ) {
			super( message );
			this.name = name;
		}
	};
	const headerLists = new WeakMap();
	class Headers {
		constructor( init ) {
			headerLists.set( this, [] );
			if ( init instanceof Headers ) init.forEach( ( v, k ) => this.append( k, v ) );
			else if ( init && typeof init[Symbol.iterator] === "function" ) for ( const [ k, v ] of init ) this.append( k, v );
			else if ( init && typeof init === "object" ) for ( const k of Object.keys( init ) ) this.append( k, init[k] );
		}
		append( name, value ) {
			headerLists.get( this ).push( [ String( name ).toLowerCase(), String( value ).trim() ] );
		}
		set( name, value ) {
			this.delete( name );
			this.append( name, value );
		}
		delete( name ) {
			const key = String( name ).toLowerCase();
			headerLists.set( this, headerLists.get( this ).filter( ( [ k ] ) => k !== key ) );
		}
		get( name ) {
			const key = String( name ).toLowerCase();
			const values = headerLists.get( this ).filter( ( [ k ] ) => k === key ).map( ( [ , v ] ) => v );
			return values.length ? values.join( ", " ) : null;
		}
		getSetCookie() {
			return headerLists.get( this ).filter( ( [ k ] ) => k === "set-cookie" ).map( ( [ , v ] ) => v );
		}
		has( name ) {
			return this.get( name ) !== null;
		}
		*entries() {
			const names = [ ...new Set( headerLists.get( this ).map( ( [ k ] ) => k ) ) ].sort();
			for ( const k of names ) {
				if ( k === "set-cookie" ) for ( const v of this.getSetCookie() ) yield [ k, v ];
				else yield [ k, this.get( k ) ];
			}
		}
		*keys() {
			for ( const [ k ] of this.entries() ) yield k;
		}
		*values() {
			for ( const [ , v ] of this.entries() ) yield v;
		}
		forEach( fn, thisArg ) {
			for ( const [ k, v ] of this.entries() ) fn.call( thisArg, v, k, this );
		}
		[Symbol.iterator]() {
			return this.entries();
		}
	}
	const utf8 = new TextDecoder();
	const bodyBytes = body => {
		if ( body === undefined || body === null ) return [ null, null ];
		if ( typeof body === "string" ) return [ Buffer.from( body ), "text/plain;charset=UTF-8" ];
		if ( body instanceof URLSearchParams ) return [ Buffer.from( body.toString() ), "application/x-www-form-urlencoded;charset=UTF-8" ];
		if ( body instanceof ArrayBuffer ) return [ new Uint8Array( body ), null ];
		if ( ArrayBuffer.isView( body ) ) return [ new Uint8Array( body.buffer, body.byteOffset, body.byteLength ), null ];
		return [ Buffer.from( String( body ) ), "text/plain;charset=UTF-8" ];
	};
	class Body {
		#bytes;
		#used = false;
		constructor( bytes ) {
			this.#bytes = bytes;
		}
		get bodyUsed() {
			return this.#used;
		}
		get body() {
			return this.#bytes === null ? null : { locked: false };
		}
		#take() {
			if ( this.#used ) return Promise.reject( new TypeError( "Body is unusable: Body has already been read" ) );
			this.#used = true;
			return Promise.resolve( this.#bytes ?? new Uint8Array( 0 ) );
		}
		bytes() {
			return this.#take().then( b => new Uint8Array( b ) );
		}
		arrayBuffer() {
			return this.#take().then( b => b.buffer.slice( b.byteOffset, b.byteOffset + b.byteLength ) );
		}
		text() {
			return this.#take().then( b => utf8.decode( b ) );
		}
		json() {
			return this.text().then( JSON.parse );
		}
		get _bytes() {
			return this.#bytes;
		}
	}
	class Response extends Body {
		#init;
		constructor( body = null, init = {} ) {
			const [ bytes, type ] = bodyBytes( body );
			super( bytes );
			const headers = new Headers( init.headers );
			if ( type && !headers.has( "content-type" ) ) headers.set( "content-type", type );
			this.#init = { status: init.status ?? 200, statusText: init.statusText ?? "", headers, url: init.url ?? "", redirected: Boolean( init.redirected ), type: init.type ?? "default" };
		}
		static json( data, init = {} ) {
			const headers = new Headers( init.headers );
			if ( !headers.has( "content-type" ) ) headers.set( "content-type", "application/json" );
			return new Response( JSON.stringify( data ), { ...init, headers } );
		}
		static error() {
			return new Response( null, { status: 0, type: "error" } );
		}
		static redirect( url, status = 302 ) {
			return new Response( null, { status, headers: { location: String( url ) } } );
		}
		get status() { return this.#init.status; }
		get ok() { return this.#init.status >= 200 && this.#init.status < 300; }
		get statusText() { return this.#init.statusText; }
		get headers() { return this.#init.headers; }
		get url() { return this.#init.url; }
		get redirected() { return this.#init.redirected; }
		get type() { return this.#init.type; }
		clone() {
			if ( this.bodyUsed ) throw new TypeError( "Response.clone: Body has already been consumed." );
			return new Response( this._bytes && new Uint8Array( this._bytes ), { ...this.#init, headers: new Headers( this.#init.headers ) } );
		}
	}
	class Request extends Body {
		#init;
		constructor( input, init = {} ) {
			const from = input instanceof Request ? input : null;
			const [ bytes, type ] = bodyBytes( init.body !== undefined ? init.body : from ? from._bytes : null );
			super( bytes );
			const headers = new Headers( init.headers ?? from?.headers );
			if ( type && !headers.has( "content-type" ) ) headers.set( "content-type", type );
			const method = String( init.method ?? from?.method ?? "GET" ).toUpperCase();
			if ( bytes && ( method === "GET" || method === "HEAD" ) ) throw new TypeError( "Request with GET/HEAD method cannot have body." );
			this.#init = { url: new URL( from ? from.url : input ).href, method, headers, redirect: init.redirect ?? from?.redirect ?? "follow", signal: init.signal ?? from?.signal ?? null };
		}
		get url() { return this.#init.url; }
		get method() { return this.#init.method; }
		get headers() { return this.#init.headers; }
		get redirect() { return this.#init.redirect; }
		get signal() { return this.#init.signal; }
		clone() {
			return new Request( this );
		}
	}
	class AbortSignal extends EventTarget {
		aborted = false;
		reason = undefined;
		onabort = null;
		static abort( reason ) {
			const c = new AbortController();
			c.abort( reason );
			return c.signal;
		}
		// Passed on to the request as its timeout.
		static timeout( ms ) {
			const signal = new AbortSignal();
			signal._timeout = ms;
			setTimeout( () => signal._abort( new DOMException( "The operation was aborted due to timeout", "TimeoutError" ) ), ms ).unref();
			return signal;
		}
		throwIfAborted() {
			if ( this.aborted ) throw this.reason;
		}
		_abort( reason ) {
			if ( this.aborted ) return;
			this.aborted = true;
			this.reason = reason ?? new DOMException( "This operation was aborted", "AbortError" );
			const event = new Event( "abort" );
			if ( typeof this.onabort === "function" ) this.onabort( event );
			this.dispatchEvent( event );
		}
	}
	class AbortController {
		signal = new AbortSignal();
		abort( reason ) {
			this.signal._abort( reason );
		}
	}
	globalThis.fetch = ( input, init = {} ) => {
		let request;
		try {
			request = input instanceof Request && !Object.keys( init ).length ? input : new Request( input instanceof URL ? input.href : input, init );
		} catch ( e ) {
			return Promise.reject( e );
		}
		const protocol = new URL( request.url ).protocol;
		if ( protocol !== "http:" && protocol !== "https:" ) return Promise.reject( new TypeError( `fetch failed: ${ request.url }: only http: and https: URLs can be fetched` ) );
		const signal = request.signal;
		if ( signal && signal.aborted ) return Promise.reject( signal.reason );
		return new Promise( ( resolve, reject ) => {
			const id = native.fetchStart( request.url, request.method, [ ...request.headers ], request._bytes, request.redirect, signal && signal._timeout || 0 );
			pendingFetches.set( id, done => {
				if ( done.error ) {
					const timedOut = done.error.endsWith( "(TimeoutError)" );
					reject( timedOut ? new DOMException( "The operation was aborted due to timeout", "TimeoutError" ) : Object.assign( new TypeError( done.error ), { cause: new Error( done.error ) } ) );
					return;
				}
				resolve( new Response( done.body, { status: done.status, statusText: done.statusText, headers: done.headers, url: done.url, redirected: done.redirected, type: "basic" } ) );
			} );
			// An abort settles the promise; the request still finishes in the background.
			signal?.addEventListener( "abort", () => {
				pendingFetches.delete( id );
				reject( signal.reason );
			} );
		} );
	};
	Object.assign( globalThis, { Headers, Request, Response, AbortController, AbortSignal } );

	// ---- Modules that packages require at load time but a build has no use
	// for (servers, sockets, processes): they load, and calling them throws.
	const unavailable = name => () => {
		throw new Error( `node:${ name } isn't available in ssqch` );
	};
	const stubModule = ( name, fns, classes = [] ) => {
		const m = {};
		for ( const fn of fns ) m[fn] = unavailable( name );
		for ( const cls of classes ) {
			m[cls] = class extends EventEmitter {
				constructor() {
					super();
					unavailable( name )();
				}
			};
		}
		return m;
	};
	const http = { ...stubModule( "http", [ "request", "get", "createServer" ], [ "Agent", "Server", "ClientRequest", "IncomingMessage", "ServerResponse" ] ), STATUS_CODES: {}, METHODS: [ "DELETE", "GET", "HEAD", "OPTIONS", "PATCH", "POST", "PUT" ] };
	// Stream classes can be extended (packages define their own at load
	// time); they don't move any data.
	class Stream extends EventEmitter {
		pipe( dest ) {
			return dest;
		}
	}
	class Readable extends Stream {}
	class Writable extends Stream {}
	class Duplex extends Readable {}
	class Transform extends Duplex {}
	class PassThrough extends Transform {}
	Object.assign( Stream, { Stream, Readable, Writable, Duplex, Transform, PassThrough, pipeline: unavailable( "stream" ), finished: unavailable( "stream" ) } );
	const stubs = {
		http,
		https: { ...http, ...stubModule( "https", [ "request", "get", "createServer" ], [ "Agent", "Server" ] ) },
		http2: stubModule( "http2", [ "connect", "createServer", "createSecureServer" ] ),
		net: stubModule( "net", [ "connect", "createConnection", "createServer", "isIP", "isIPv4", "isIPv6" ], [ "Socket", "Server" ] ),
		tls: stubModule( "tls", [ "connect", "createServer", "createSecureContext" ], [ "TLSSocket", "Server" ] ),
		dns: stubModule( "dns", [ "lookup", "resolve", "resolve4", "resolve6" ] ),
		child_process: stubModule( "child_process", [ "exec", "execSync", "execFile", "execFileSync", "spawn", "spawnSync", "fork" ] ),
		worker_threads: { isMainThread: true, parentPort: null, workerData: null, threadId: 0, ...stubModule( "worker_threads", [], [ "Worker", "MessageChannel" ] ) },
		cluster: { isPrimary: true, isMaster: true, isWorker: false, ...stubModule( "cluster", [ "fork", "setupPrimary" ] ) },
		readline: stubModule( "readline", [ "createInterface", "emitKeypressEvents", "clearLine", "cursorTo" ] ),
		zlib: stubModule( "zlib", [ "gzipSync", "gunzipSync", "deflateSync", "inflateSync", "brotliCompressSync", "brotliDecompressSync", "createGzip", "createGunzip" ] ),
		vm: stubModule( "vm", [ "runInNewContext", "runInThisContext", "createContext" ], [ "Script" ] ),
		stream: Stream,
		tty: { isatty: () => false, ReadStream: Readable, WriteStream: Writable },
		perf_hooks: { performance: globalThis.performance ?? { now } }
	};

	// ---- CommonJS: `require` and `module.exports`. Files are resolved and
	// read in Rust (modules.rs), run here inside Node's function wrapper.
	const cjs = globalThis.__ssqch_cjs;
	delete globalThis.__ssqch_cjs;
	const requireCache = Object.create( null );
	const builtinModules = [];
	const builtin = name => {
		const m = globalThis.__ssqch.node[name];
		if ( !m ) throw new Error( `Cannot find module 'node:${ name }'` );
		return m;
	};
	const dirname = file => file.replace( /\/[^/]*$/, "" ) || "/";
	const loadModule = name => {
		if ( name.startsWith( "node:" ) ) return builtin( name.slice( 5 ) );
		const filename = cjs.absolute( name );
		const query = name.includes( "?" ) ? name.slice( name.indexOf( "?" ) ) : "";
		const key = filename + query;
		const cached = requireCache[key];
		if ( cached ) return cached.exports;
		const { format, source } = cjs.read( name );
		if ( format === "esm" ) return cjs.importSync( name );
		const module = { id: key, filename, path: dirname( filename ), exports: {}, loaded: false, children: [], paths: [] };
		module.require = makeRequire( name );
		requireCache[key] = module;
		try {
			if ( format === "json" ) {
				try {
					module.exports = JSON.parse( source );
				} catch ( e ) {
					throw new SyntaxError( `${ name }: ${ e.message }` );
				}
			} else {
				cjs.compile( name, source ).call( module.exports, module.exports, module.require, module, filename, module.path );
			}
		} catch ( e ) {
			delete requireCache[key];
			throw e;
		}
		module.loaded = true;
		return module.exports;
	};
	function makeRequire( from ) {
		const require = spec => {
			if ( typeof spec !== "string" ) throw new TypeError( `The "id" argument must be of type string. Received ${ typeof spec }` );
			return loadModule( cjs.resolve( from, spec ) );
		};
		require.resolve = spec => {
			const name = cjs.resolve( from, spec );
			return name.startsWith( "node:" ) ? spec : name.includes( ":" ) && !/^[A-Za-z]:/.test( name ) || !name.includes( "/" ) && !name.includes( "." ) ? name : cjs.absolute( name );
		};
		require.resolve.paths = () => [];
		require.cache = requireCache;
		require.main = undefined;
		return require;
	}
	const moduleFrom = file => {
		let path = typeof file === "string" ? file : String( file && file.href || file );
		if ( path.startsWith( "file:" ) ) path = url.fileURLToPath( path );
		return cjs.nameOf( path );
	};
	const moduleApi = {
		createRequire: file => makeRequire( moduleFrom( file ) ),
		builtinModules,
		isBuiltin: name => builtinModules.includes( String( name ).replace( /^node:/, "" ) )
	};
	globalThis.__ssqch.cjs = {
		load: loadModule,
		// Run a CommonJS file for `import`, and list what it exports.
		exportNames( name ) {
			const exports = loadModule( name );
			return exports !== null && ( typeof exports === "object" || typeof exports === "function" ) ? Object.keys( exports ) : [];
		}
	};

	globalThis.__ssqch.node = {
		crypto,
		fs,
		"fs/promises": promises,
		path,
		"path/posix": path,
		url,
		process: globalThis.process,
		buffer: { Buffer },
		module: moduleApi,
		util,
		events: EventEmitter,
		os,
		assert,
		"assert/strict": assert,
		timers: timerFns,
		"timers/promises": timersPromises,
		string_decoder: { StringDecoder },
		...stubs
	};
	builtinModules.push( ...Object.keys( globalThis.__ssqch.node ) );
} )();
