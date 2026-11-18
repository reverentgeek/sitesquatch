// `strftime` patterns, as 0.7 formatted them (Rust's chrono), in UTC. ssqch's date filters
// (`dateformat`, `date.strftime()`) use it, so a page's dates don't depend on the machine's time
// zone, its locale, or `Intl`, whose answers change between Node releases.

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** What a pattern can't be: a `%` that names nothing chrono knows. */
export class BadPattern extends Error {}

/** `date` (UTC) with `pattern`: `%B %-d, %Y` is `March 14, 2026`. Throws `BadPattern` for a specifier chrono doesn't have. */
export function strftime(date: Date, pattern: string): string {
	let out = "";
	for (let i = 0; i < pattern.length; i++) {
		const c = pattern[i];
		if (c !== "%") {
			out += c;
			continue;
		}
		// A padding flag: `-` none, `_` spaces, `0` zeros.
		let pad: string | undefined;
		let next = pattern[++i];
		if (next === "-" || next === "_" || next === "0") {
			pad = next;
			next = pattern[++i];
		}
		if (next === undefined) throw new BadPattern();
		// `%.f`, `%.3f`, `%3f`, `%:z` and friends are longer.
		const rest = pattern.slice(i);
		const long = /^(?:\.[369]?f|[369]f|:{1,3}z|#z)/.exec(rest);
		if (long) {
			out += fixed(date, long[0]);
			i += long[0].length - 1;
			continue;
		}
		out += field(date, next, pad);
	}
	return out;
}

function field(d: Date, spec: string, pad: string | undefined): string {
	const num = (n: number, width: number, fill: "0" | " ") => {
		const text = String(Math.abs(n));
		const by = pad === "-" ? "" : pad === "_" ? " " : pad === "0" ? "0" : fill;
		return (n < 0 ? "-" : "") + (by ? text.padStart(width, by) : text);
	};
	const year = d.getUTCFullYear(), month = d.getUTCMonth(), day = d.getUTCDate(), wday = d.getUTCDay();
	const hour = d.getUTCHours(), yday = dayOfYear(d);
	switch (spec) {
		case "Y": return num(year, 4, "0");
		case "C": return num(Math.floor(year / 100), 2, "0");
		case "y": return num(((year % 100) + 100) % 100, 2, "0");
		case "m": return num(month + 1, 2, "0");
		case "b": case "h": return MONTHS[month].slice(0, 3);
		case "B": return MONTHS[month];
		case "d": return num(day, 2, "0");
		case "e": return num(day, 2, " ");
		case "a": return DAYS[wday].slice(0, 3);
		case "A": return DAYS[wday];
		case "w": return num(wday, 1, "0");
		case "u": return num(wday === 0 ? 7 : wday, 1, "0");
		case "U": return num(Math.floor((yday - 1 + 7 - wday) / 7), 2, "0");
		case "W": return num(Math.floor((yday - 1 + 7 - ((wday + 6) % 7)) / 7), 2, "0");
		case "G": return num(isoWeek(d).year, 4, "0");
		case "g": return num(((isoWeek(d).year % 100) + 100) % 100, 2, "0");
		case "V": return num(isoWeek(d).week, 2, "0");
		case "j": return num(yday, 3, "0");
		case "D": case "x": return `${field(d, "m", undefined)}/${field(d, "d", undefined)}/${field(d, "y", undefined)}`;
		case "F": return `${field(d, "Y", undefined)}-${field(d, "m", undefined)}-${field(d, "d", undefined)}`;
		case "v": return `${field(d, "e", undefined)}-${field(d, "b", undefined)}-${field(d, "Y", undefined)}`;
		case "H": return num(hour, 2, "0");
		case "k": return num(hour, 2, " ");
		case "I": return num(hour % 12 || 12, 2, "0");
		case "l": return num(hour % 12 || 12, 2, " ");
		case "P": return hour < 12 ? "am" : "pm";
		case "p": return hour < 12 ? "AM" : "PM";
		case "M": return num(d.getUTCMinutes(), 2, "0");
		case "S": return num(d.getUTCSeconds(), 2, "0");
		case "f": return String(d.getUTCMilliseconds() * 1_000_000).padStart(9, "0");
		case "R": return `${field(d, "H", undefined)}:${field(d, "M", undefined)}`;
		case "T": case "X": return `${field(d, "H", undefined)}:${field(d, "M", undefined)}:${field(d, "S", undefined)}`;
		case "r": return `${field(d, "I", undefined)}:${field(d, "M", undefined)}:${field(d, "S", undefined)} ${field(d, "p", undefined)}`;
		case "c": return `${field(d, "a", undefined)} ${field(d, "b", undefined)} ${field(d, "e", undefined)} ${field(d, "T", undefined)} ${field(d, "Y", undefined)}`;
		case "+": return `${field(d, "Y", undefined)}-${field(d, "m", undefined)}-${field(d, "d", undefined)}T${field(d, "T", undefined)}${fixed(d, ".f")}+00:00`;
		case "s": return String(Math.floor(d.getTime() / 1000));
		case "Z": return "UTC";
		case "z": return "+0000";
		case "t": return "\t";
		case "n": return "\n";
		case "%": return "%";
		default: throw new BadPattern();
	}
}

/** The specifiers with more than one letter: fractions of a second and the zone's offset. */
function fixed(d: Date, spec: string): string {
	const nanos = d.getUTCMilliseconds() * 1_000_000;
	const digits = (n: number) => String(nanos).padStart(9, "0").slice(0, n);
	switch (spec) {
		// As few digits as it takes (3, 6 or 9), and nothing for a whole second.
		case ".f": return nanos === 0 ? "" : nanos % 1_000_000 === 0 ? `.${digits(3)}` : nanos % 1000 === 0 ? `.${digits(6)}` : `.${digits(9)}`;
		case ".3f": case ".6f": case ".9f": return `.${digits(Number(spec[1]))}`;
		case "3f": case "6f": case "9f": return digits(Number(spec[0]));
		case ":z": return "+00:00";
		case "::z": return "+00:00:00";
		case ":::z": return "+00";
		case "#z": return "+00";
		default: throw new BadPattern();
	}
}

/** Midnight UTC of a day, for any year: `Date.UTC` reads the years 0 to 99 as 1900 to 1999. */
function utc(year: number, month: number, day: number): number {
	const d = new Date(0);
	d.setUTCFullYear(year, month, day);
	return d.getTime();
}

/** The day of the year, from 1. */
function dayOfYear(d: Date): number {
	return Math.floor((utc(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - utc(d.getUTCFullYear(), 0, 1)) / 86_400_000) + 1;
}

/** The ISO 8601 week and the year it belongs to: weeks start on Monday, and week 1 has the year's first Thursday. */
function isoWeek(d: Date): { year: number; week: number } {
	const day = new Date(utc(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
	const weekday = day.getUTCDay() || 7;
	// The Thursday of this week decides the year.
	day.setUTCDate(day.getUTCDate() + 4 - weekday);
	const year = day.getUTCFullYear();
	const week = Math.ceil(((day.getTime() - utc(year, 0, 1)) / 86_400_000 + 1) / 7);
	return { year, week };
}
