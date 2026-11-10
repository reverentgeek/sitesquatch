// QuickJS has no `Intl`, so `toLocaleDateString()` ignores its locale and
// options. This adds `en-US` date, time and number formatting, matching
// Node's output (checked against Node 24 in tests/fixtures/intl-cases.mjs).
// Other locales and time zones other than UTC and the local one throw, rather
// than quietly formatting something else.
( () => {
	if ( typeof globalThis.Intl !== "undefined" ) return;

	const LOCALES = [ undefined, "en", "en-US", "default" ];
	const checkLocale = ( what, locales ) => {
		const list = Array.isArray( locales ) ? locales : [ locales ];
		if ( !list.every( l => LOCALES.includes( l ) ) ) {
			throw new RangeError( `${ what }: only "en-US" formatting is available in ssqch (got ${ JSON.stringify( locales ) })` );
		}
	};

	const MONTHS = [ "January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December" ];
	const DAYS = [ "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday" ];
	const name = ( list, i, width ) => width === "long" ? list[i] : width === "short" ? list[i].slice( 0, 3 ) : list[i][0];
	const pad2 = n => String( n ).padStart( 2, "0" );

	const DATE_STYLES = {
		full: { weekday: "long", year: "numeric", month: "long", day: "numeric" },
		long: { year: "numeric", month: "long", day: "numeric" },
		medium: { year: "numeric", month: "short", day: "numeric" },
		short: { year: "2-digit", month: "numeric", day: "numeric" }
	};
	const TIME_STYLES = {
		full: { hour: "numeric", minute: "2-digit", second: "2-digit", zone: "long" },
		long: { hour: "numeric", minute: "2-digit", second: "2-digit", zone: "short" },
		medium: { hour: "numeric", minute: "2-digit", second: "2-digit" },
		short: { hour: "numeric", minute: "2-digit" }
	};
	const FIELDS = [ "weekday", "year", "month", "day", "hour", "minute", "second" ];
	const KNOWN = [ ...FIELDS, "timeZone", "hour12", "hourCycle", "dateStyle", "timeStyle", "localeMatcher", "formatMatcher", "calendar", "numberingSystem" ];

	class DateTimeFormat {
		constructor( locales, options = {}, defaults = "date" ) {
			checkLocale( "Intl.DateTimeFormat", locales );
			for ( const key of Object.keys( options ) ) {
				if ( !KNOWN.includes( key ) ) throw new RangeError( `Intl.DateTimeFormat: the "${ key }" option isn't supported in ssqch` );
			}
			const zone = options.timeZone;
			if ( zone !== undefined && ![ "UTC", "Etc/UTC", "GMT", "Etc/GMT" ].includes( zone ) ) {
				throw new RangeError( `Intl.DateTimeFormat: only the UTC and local time zones are available in ssqch (got "${ zone }")` );
			}
			this.utc = zone !== undefined;
			this.zoneName = zone === undefined ? undefined : zone.replace( "Etc/", "" );
			this.hour12 = options.hour12 ?? ( options.hourCycle ? options.hourCycle === "h12" || options.hourCycle === "h11" : true );
			if ( defaults === "date" && options.timeStyle !== undefined ) throw new TypeError( "Invalid option : timeStyle" );
			if ( defaults === "time" && options.dateStyle !== undefined ) throw new TypeError( "Invalid option : dateStyle" );
			this.styles = options.dateStyle || options.timeStyle ? { date: options.dateStyle, time: options.timeStyle } : null;
			if ( this.styles ) {
				if ( FIELDS.some( f => options[f] !== undefined ) ) throw new TypeError( "Can't set option dateStyle or timeStyle with other date and time fields" );
				this.date = DATE_STYLES[options.dateStyle] || null;
				this.time = TIME_STYLES[options.timeStyle] || null;
			} else {
				// The spec's ToDateTimeOptions: toLocaleDateString always shows a
				// date, toLocaleTimeString a time, and with no fields at all
				// DateTimeFormat shows a date and toLocaleString both.
				const hasDate = [ "weekday", "year", "month", "day" ].some( f => options[f] !== undefined );
				const hasTime = [ "hour", "minute", "second" ].some( f => options[f] !== undefined );
				const fields = { ...options };
				const addDate = defaults === "date" ? !hasDate : ( defaults === "both" || defaults === "format" ) && !hasDate && !hasTime;
				const addTime = defaults === "time" ? !hasTime : defaults === "both" && !hasDate && !hasTime;
				if ( addDate ) Object.assign( fields, { year: "numeric", month: "numeric", day: "numeric" } );
				if ( addTime ) Object.assign( fields, { hour: "numeric", minute: "2-digit", second: "2-digit" } );
				const pick = list => list.some( f => fields[f] !== undefined ) ? Object.fromEntries( list.map( f => [ f, fields[f] ] ) ) : null;
				this.date = pick( [ "weekday", "year", "month", "day" ] );
				this.time = pick( [ "hour", "minute", "second" ] );
			}
		}

		parts( date ) {
			const d = date === undefined ? new Date() : new Date( typeof date === "number" ? date : +date );
			if ( Number.isNaN( d.getTime() ) ) throw new RangeError( "Invalid time value" );
			const u = this.utc;
			return {
				year: u ? d.getUTCFullYear() : d.getFullYear(),
				month: u ? d.getUTCMonth() : d.getMonth(),
				day: u ? d.getUTCDate() : d.getDate(),
				weekday: u ? d.getUTCDay() : d.getDay(),
				hour: u ? d.getUTCHours() : d.getHours(),
				minute: u ? d.getUTCMinutes() : d.getMinutes(),
				second: u ? d.getUTCSeconds() : d.getSeconds()
			};
		}

		formatDate( p, o ) {
			const year = o.year === "2-digit" ? pad2( p.year % 100 ) : o.year ? String( p.year ) : null;
			const day = o.day === "2-digit" ? pad2( p.day ) : o.day ? String( p.day ) : null;
			const weekday = o.weekday ? name( DAYS, p.weekday, o.weekday ) : null;
			if ( o.month && ![ "numeric", "2-digit" ].includes( o.month ) ) {
				const month = name( MONTHS, p.month, o.month );
				let out = day ? `${ month } ${ day }` : month;
				if ( year ) out += day ? `, ${ year }` : ` ${ year }`;
				return weekday ? `${ weekday }, ${ out }` : out;
			}
			const month = o.month === "2-digit" ? pad2( p.month + 1 ) : o.month ? String( p.month + 1 ) : null;
			const numeric = [ month, day, year ].filter( Boolean ).join( "/" );
			if ( !weekday ) return numeric;
			return numeric ? `${ weekday }, ${ numeric }` : weekday;
		}

		formatTime( p, o ) {
			let hour = p.hour;
			let suffix = "";
			if ( this.hour12 ) {
				suffix = hour < 12 ? " AM" : " PM";
				hour = hour % 12 || 12;
			}
			const h = o.hour === "2-digit" || ( !this.hour12 && o.minute ) ? pad2( hour ) : String( hour );
			const parts = [ o.hour ? h : null, o.minute ? pad2( p.minute ) : null, o.second ? pad2( p.second ) : null ].filter( Boolean );
			let out = parts.join( ":" ) + ( o.hour ? suffix : "" );
			if ( o.zone ) out += ` ${ o.zone === "long" ? ( this.utc ? "Coordinated Universal Time" : "Local Time" ) : this.zoneName || "Local" }`;
			return out;
		}

		format( date ) {
			const p = this.parts( date );
			const date_ = this.date ? this.formatDate( p, this.date ) : "";
			const time = this.time ? this.formatTime( p, this.time ) : "";
			if ( date_ && time ) {
				// ICU's en-US joiners: " at " after a long month name, a space
				// after a weekday alone, a comma otherwise.
				const o = this.date;
				if ( !this.styles && o.weekday && !o.year && !o.month && !o.day ) return `${ date_ } ${ time }`;
				const at = this.styles ? [ "full", "long" ].includes( this.styles.date ) : o.month === "long";
				return `${ date_ }${ at ? " at " : ", " }${ time }`;
			}
			return date_ || time;
		}

		resolvedOptions() {
			return { locale: "en-US", calendar: "gregory", numberingSystem: "latn", timeZone: this.utc ? "UTC" : undefined };
		}
	}

	class NumberFormat {
		constructor( locales, options = {} ) {
			checkLocale( "Intl.NumberFormat", locales );
			for ( const key of Object.keys( options ) ) {
				if ( ![ "minimumFractionDigits", "maximumFractionDigits", "useGrouping", "localeMatcher" ].includes( key ) ) {
					throw new RangeError( `Intl.NumberFormat: the "${ key }" option isn't supported in ssqch` );
				}
			}
			this.min = options.minimumFractionDigits ?? 0;
			this.max = Math.max( options.maximumFractionDigits ?? Math.max( this.min, 3 ), this.min );
			this.grouping = options.useGrouping ?? true;
		}

		format( n ) {
			const x = Number( n );
			if ( !Number.isFinite( x ) ) return Number.isNaN( x ) ? "NaN" : x > 0 ? "∞" : "-∞";
			let [ int, frac = "" ] = Math.abs( x ).toFixed( this.max ).split( "." );
			frac = frac.replace( /0+$/, "" ).padEnd( this.min, "0" );
			if ( this.grouping ) int = int.replace( /\B(?=(\d{3})+(?!\d))/g, "," );
			const out = frac ? `${ int }.${ frac }` : int;
			// Like ICU, a negative number keeps its sign even when it rounds to 0.
			return x < 0 || Object.is( x, -0 ) ? `-${ out }` : out;
		}

		resolvedOptions() {
			return { locale: "en-US", numberingSystem: "latn", minimumFractionDigits: this.min, maximumFractionDigits: this.max };
		}
	}

	globalThis.Intl = {
		DateTimeFormat: function ( locales, options ) {
			return new DateTimeFormat( locales, options, "format" );
		},
		NumberFormat: function ( locales, options ) {
			return new NumberFormat( locales, options );
		}
	};
	// Collation: an approximation of ICU's root order for Latin text, which
	// `en` uses. Strings compare by base letters first (spaces, then
	// punctuation, then digits, then letters), then by accents, then by case
	// (lowercase first), as `"a" < "B" < "b"` and `"resume" < "résumé"`.
	const COLLATOR_OPTIONS = [ "sensitivity", "numeric", "ignorePunctuation", "usage", "caseFirst", "localeMatcher", "collation" ];
	const charClass = c => /\s/u.test( c ) ? 0 : /[\p{P}\p{S}]/u.test( c ) ? 1 : /\p{Nd}/u.test( c ) ? 2 : /\p{L}/u.test( c ) ? 3 : 4;
	class Collator {
		constructor( locales, options = {} ) {
			checkLocale( "Intl.Collator", locales );
			for ( const key of Object.keys( options ) ) {
				if ( !COLLATOR_OPTIONS.includes( key ) ) throw new RangeError( `Intl.Collator: the "${ key }" option isn't supported in ssqch` );
			}
			this.sensitivity = options.sensitivity ?? "variant";
			this.numeric = Boolean( options.numeric );
			this.ignorePunctuation = Boolean( options.ignorePunctuation );
			this.upperFirst = options.caseFirst === "upper";
			this.compare = ( a, b ) => this.#compare( String( a ), String( b ) );
		}
		// [primary keys, accent marks, case flags] for a string.
		#keys( s ) {
			const primary = [], accents = [], cases = [];
			const chars = [ ...s.normalize( "NFD" ) ];
			for ( let i = 0; i < chars.length; i++ ) {
				const c = chars[i];
				if ( /\p{M}/u.test( c ) ) { accents[accents.length - 1] += c; continue; }
				const cls = charClass( c );
				if ( this.ignorePunctuation && cls <= 1 ) continue;
				if ( this.numeric && cls === 2 ) {
					let j = i;
					while ( j + 1 < chars.length && charClass( chars[j + 1] ) === 2 ) j++;
					const digits = chars.slice( i, j + 1 ).join( "" ).replace( /^0+(?=\d)/u, "" );
					primary.push( [ 2, digits.length, digits ] );
					accents.push( "" );
					cases.push( 0 );
					i = j;
					continue;
				}
				const lower = c.toLowerCase();
				primary.push( [ cls, 0, lower ] );
				accents.push( "" );
				cases.push( c === lower ? 0 : 1 );
			}
			return [ primary, accents, cases ];
		}
		#compare( a, b ) {
			const [ pa, aa, ca ] = this.#keys( a ), [ pb, ab, cb ] = this.#keys( b );
			const cmp = ( x, y ) => ( x < y ? -1 : x > y ? 1 : 0 );
			for ( let i = 0; i < Math.min( pa.length, pb.length ); i++ ) {
				const d = cmp( pa[i][0], pb[i][0] ) || cmp( pa[i][1], pb[i][1] ) || cmp( pa[i][2], pb[i][2] );
				if ( d ) return d;
			}
			if ( pa.length !== pb.length ) return cmp( pa.length, pb.length );
			if ( this.sensitivity === "accent" || this.sensitivity === "variant" ) {
				for ( let i = 0; i < aa.length; i++ ) {
					const d = cmp( aa[i], ab[i] );
					if ( d ) return d;
				}
			}
			if ( this.sensitivity === "case" || this.sensitivity === "variant" ) {
				for ( let i = 0; i < ca.length; i++ ) {
					if ( ca[i] !== cb[i] ) return ( ca[i] - cb[i] ) * ( this.upperFirst ? -1 : 1 );
				}
			}
			return 0;
		}
		resolvedOptions() {
			return { locale: "en-US", usage: "sort", sensitivity: this.sensitivity, ignorePunctuation: this.ignorePunctuation, collation: "default", numeric: this.numeric, caseFirst: this.upperFirst ? "upper" : "false" };
		}
	}
	Intl.Collator = function ( locales, options ) {
		return new Collator( locales, options );
	};

	const define = ( proto, key, fn ) => Object.defineProperty( proto, key, { value: fn, writable: true, configurable: true } );
	define( String.prototype, "localeCompare", function ( that, locales, options ) {
		return new Collator( locales, options ).compare( this, that );
	} );
	define( Date.prototype, "toLocaleDateString", function ( locales, options ) {
		return new DateTimeFormat( locales, options, "date" ).format( this );
	} );
	define( Date.prototype, "toLocaleTimeString", function ( locales, options ) {
		return new DateTimeFormat( locales, options, "time" ).format( this );
	} );
	define( Date.prototype, "toLocaleString", function ( locales, options ) {
		return new DateTimeFormat( locales, options, "both" ).format( this );
	} );
	define( Number.prototype, "toLocaleString", function ( locales, options ) {
		return new NumberFormat( locales, options ).format( this );
	} );
} )();
