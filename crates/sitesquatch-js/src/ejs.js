// EJS templates (`.ejs`), compiled to JavaScript functions the way EJS 3
// compiles them, and run on the engine the config runs on. Loaded on the
// first `.ejs` render (see ejs.rs).
//
// Tags: `<%` code, `<%=` escaped output, `<%-` raw output, `<%#` a comment,
// `<%%` a literal `<%`, and `<%_` to drop the spaces and tabs before it. A
// tag closed with `-%>` drops the newline after it, and `_%>` the spaces,
// tabs and newline after it. `include(name, data)` renders another template.
"use strict";
( () => {
	const ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&#34;", "'": "&#39;" };
	const escapeFn = value => value === undefined || value === null ? "" : String( value ).replace( /[&<>"']/g, c => ESCAPES[c] );

	// The template's text and tags in order, as `source.split( /(<%%|%%>|<%=|<%-|<%_|<%#|<%|%>|-%>|_%>)/ )`
	// would give them (without the empty strings), found with indexOf, which is
	// several times faster than that regex in QuickJS.
	function tokens( source ) {
		const out = [];
		let at = 0;
		for ( ;; ) {
			const open = source.indexOf( "<%", at );
			let close = source.indexOf( "%>", at );
			if ( open < 0 && close < 0 ) break;
			let tag;
			if ( close > at && "-_%".includes( source[close - 1] ) ) close -= 1;
			if ( open >= 0 && ( close < 0 || open < close ) ) {
				tag = "%=-_#".includes( source[open + 2] ) && open + 2 < source.length ? "<%" + source[open + 2] : "<%";
				if ( open > at ) out.push( source.slice( at, open ) );
				at = open + tag.length;
			} else {
				tag = source[close] === "%" && source[close + 1] === ">" ? "%>" : source[close] + "%>";
				if ( close > at ) out.push( source.slice( at, close ) );
				at = close + tag.length;
			}
			out.push( tag );
		}
		if ( at < source.length ) out.push( source.slice( at ) );
		return out;
	}

	const newlines = text => {
		let n = 0;
		for ( let i = text.indexOf( "\n" ); i >= 0; i = text.indexOf( "\n", i + 1 ) ) n++;
		return n;
	};

	// JavaScript's reserved words, and names the compiled code uses, which can't be
	// a template's variables.
	const RESERVED = new Set( ( "break case catch class const continue debugger default delete do else enum export extends false finally for function if import in instanceof " +
		"new null return super switch this throw true try typeof var void while with yield let static implements interface package private protected public await " +
		"arguments eval undefined NaN Infinity include" ).split( " " ) );
	// JavaScript's identifiers, Unicode ones included (`café`).
	const IDENTIFIER = /(?<![\p{ID_Continue}$\u200c\u200d.])[\p{ID_Start}_$][\p{ID_Continue}$\u200c\u200d]*/gu;

	// A template as code: the statements that build `__out` (with `__line`
	// following the template's line for errors), and the names its code uses.
	function parse( source, name ) {
		// Most Markdown pages have no tags: their text is their output.
		if ( !source.includes( "<%" ) && !source.includes( "%%>" ) ) return { name, text: source };
		if ( source.includes( "<%_" ) ) source = source.replace( /[ \t]*<%_/g, "<%_" );
		if ( source.includes( "_%>" ) ) source = source.replace( /_%>[ \t]*/g, "_%>" );
		const parts = tokens( source );
		const names = new Set();
		let code = "";
		let line = 1;
		let mode = null; // the open tag, inside one
		let open = 1; // the line it opened on
		let truncate = false;
		let text = "";
		const flush = () => {
			if ( text ) code += `__out += ${ JSON.stringify( text ) };\n`;
			text = "";
		};
		for ( const part of parts ) {
			if ( part === "" ) continue;
			if ( mode === null ) {
				switch ( part ) {
					case "<%%": text += "<%"; break;
					case "%%>": text += "%>"; break;
					case "<%": case "<%_": case "<%=": case "<%-": case "<%#":
						flush();
						mode = part;
						open = line;
						code += `__line = ${ line };\n`;
						break;
					case "%>": case "-%>": case "_%>":
						text += part; // a close tag outside a tag is text, as in EJS
						break;
					default: {
						let piece = part;
						if ( truncate ) {
							piece = piece.replace( /^(?:\r\n|\r|\n)/, "" );
							truncate = false;
						}
						text += piece;
					}
				}
				line += newlines( part );
				continue;
			}
			if ( part === "%>" || part === "-%>" || part === "_%>" ) {
				mode = null;
				truncate = part !== "%>";
				continue;
			}
			if ( part === "%%>" ) {
				// `%%>` inside a tag is a literal `%>` in its code.
				code += mode === "<%#" ? "" : "%>";
				continue;
			}
			const lines = newlines( part );
			if ( mode !== "<%#" ) for ( const [ word ] of part.matchAll( IDENTIFIER ) ) if ( !RESERVED.has( word ) && !word.startsWith( "__" ) ) names.add( word );
			switch ( mode ) {
				case "<%#": break;
				case "<%=": code += `__out += __escape(${ stripSemi( part ) });\n`; break;
				case "<%-": code += `__v = (${ stripSemi( part ) });\nif ( __v != null ) __out += __v;\n`; break;
				default: code += part + "\n";
			}
			// Newlines inside the tag's code still count.
			line += lines;
			if ( mode !== "<%#" && mode !== "<%" && mode !== "<%_" && lines ) code += `__line = ${ line };\n`;
		}
		if ( mode !== null ) throw located( new SyntaxError( `this ${ mode } tag is never closed (with %>)` ), name, open );
		flush();
		// Its own `let`, `const` or `class` could reuse a variable's name, which needs a scope of its own.
		const declares = /\b(?:let|const|class)\b/.test( code );
		return { name, code, declares, names: [ ...names ], open, compiled: new Map() };
	}

	// The template's function for the variables `present` (a subset of its names).
	// They're parameters, instead of `with ( locals )` as in EJS: a lookup through
	// `with` asks every object in scope, and page data is a Proxy (a view), so that
	// made every name in a template cost a few calls into Rust. The template's
	// own code runs in an inner function, so its `var`s and `let`s can reuse a name.
	function compile( parsed, present ) {
		const signature = present.join( "," );
		let fn = parsed.compiled.get( signature );
		if ( fn ) return fn;
		const code = parsed.declares ? "( () => {\n" + parsed.code + "\n} )();" : parsed.code;
		const body = "let __out = \"\", __line = 1, __v;\ntry {\n" + code + "\n} catch ( e ) { throw __located( e, __name, __line ); }\nreturn __out;";
		try {
			fn = new Function( "include", "__escape", "__located", "__name", ...present, body );
		} catch ( e ) {
			// A syntax error in the template's code, at the last tag (JavaScript can't say
			// which line of the template it was). An unclosed block runs into the code
			// that wraps the template.
			const unclosed = /expecting '[})]'|unexpected end|unexpected token in expression: '(?:\)|catch)'/i.test( e.message );
			const message = unclosed ? "a block opened in a <% %> tag isn't closed (a `}` is missing)" : `syntax error in the template's code: ${ e.message }`;
			throw located( new SyntaxError( message ), parsed.name, parsed.open );
		}
		parsed.compiled.set( signature, fn );
		return fn;
	}

	const stripSemi = code => code.replace( /;(\s*$)/, "$1" );

	// `index.ejs:3: message`, once (an error from an include keeps its own place).
	function located( e, name, line ) {
		if ( e && e.ejsLocated ) return e;
		const error = e instanceof Error ? e : new Error( String( e ) );
		const wrapped = new error.constructor( `${ name }:${ line }: ${ error.message }` );
		wrapped.ejsLocated = true;
		wrapped.stack = "";
		return wrapped;
	}

	// Parsed templates, by cache key, for one build (a new build starts a new cache).
	let cache = new Map();
	let generation = -1;

	function template( key, source, name ) {
		let parsed = key ? cache.get( key ) : undefined;
		if ( !parsed ) {
			parsed = parse( source, name );
			if ( key ) cache.set( key, parsed );
		}
		return parsed;
	}

	// Render `source` (the template `name`, at `file`) with `locals`. `load(from, name)`
	// finds an include: [file, name, source], or [message] when it isn't there.
	let load = null;

	// The build's include loader, set once per build (see ejs.rs).
	function start( build, loader ) {
		cache = new Map();
		generation = build;
		load = loader;
	}

	function render( source, locals, globals, name, file, key ) {
		const run = ( parsed, file, extra, depth ) => {
			if ( parsed.text !== undefined ) return parsed.text;
			const include = ( wanted, data ) => {
				if ( depth > 64 ) throw new Error( `we've passed this tree before. Include loop: ${ wanted } includes itself` );
				const found = load( file, String( wanted ) );
				if ( found.length === 1 ) throw new Error( found[0] );
				const [ path, shown, text ] = found;
				// As in EJS, an include gets what its parent had, with its own data on top.
				return run( template( "include:" + path, text, shown ), path, data ? { ...extra, ...data } : extra, depth + 1 );
			};
			// `locals` is the page's data with the includes' data on top. It's a view,
			// so the page's data isn't copied.
			const view = () => Object.keys( extra ).length === 0 ? locals : new Proxy( locals, {
				get: ( target, key ) => key in extra ? extra[key] : target[key],
				has: ( target, key ) => key in extra || key in target,
			} );
			// What each name is: an include's data, then the page's, then a filter or
			// function. Values are read, not tested with `in`, which would make a view
			// list every key of the page's data. A name nothing defines is left out, so
			// using it is a ReferenceError, as in EJS (and `typeof` it is "undefined").
			const present = [], values = [];
			for ( const n of parsed.names ) {
				let v = n === "locals" ? view() : n in extra ? extra[n] : locals[n];
				if ( v === undefined ) v = globals[n];
				if ( v !== undefined || n in extra ) {
					present.push( n );
					values.push( v );
				}
			}
			return compile( parsed, present )( include, escapeFn, located, parsed.name, ...values );
		};
		return run( template( key, source, name ), file, {}, 0 );
	}

	globalThis.__ssqch_ejs = { render, start, generation: () => generation };
} )();
