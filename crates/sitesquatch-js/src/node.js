// The parts of Node's built-in modules that site configs and data files use:
// `fs` (sync and promise APIs), `path` (POSIX), `url`, `process` and
// `Buffer`. Runs after the prelude; file access goes through `native`.
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
			for ( let i = parts.length - 1; i >= -1 && !resolved.startsWith( "/" ); i-- ) {
				const part = i >= 0 ? parts[i] : process.cwd();
				needString( "path", part );
				if ( part ) resolved = resolved ? `${ part }/${ resolved }` : part;
			}
			return trimTrailing( path.normalize( resolved ) );
		},
		isAbsolute( p ) {
			needString( "path", p );
			return p.startsWith( "/" );
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
	const url = {
		fileURLToPath( value ) {
			const href = typeof value === "string" ? value : value && value.href;
			if ( typeof href !== "string" || !href.startsWith( "file:" ) ) throw new TypeError( "The URL must be of scheme file" );
			const rest = href.slice( "file:".length ).replace( /^\/\/(localhost)?/, "" );
			return decodeURIComponent( rest.split( /[?#]/ )[0] );
		},
		pathToFileURL( p ) {
			const absolute = path.resolve( pathArg( p ) );
			const href = "file://" + encodeURI( absolute ).replace( /[?#]/g, encodeURIComponent );
			return { href, protocol: "file:", pathname: href.slice( "file://".length ), toString: () => href };
		}
	};
	if ( typeof globalThis.URL === "function" ) url.URL = globalThis.URL;

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

	globalThis.__ssqch.node = {
		fs,
		"fs/promises": promises,
		path,
		"path/posix": path,
		url,
		process: globalThis.process,
		buffer: { Buffer }
	};
} )();
