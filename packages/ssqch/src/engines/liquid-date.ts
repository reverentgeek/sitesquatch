// Dates in Liquid as 0.7 had them (from the liquid crate, `liquid-core`'s `strftime.rs` and
// `datetime.rs`): Ruby's `strftime` with English names, and a string without a time zone read as
// UTC. liquidjs has its own, but it names months and days through `Intl` and reads a string in
// the machine's time zone, and a build's output may depend on neither.
import { buildTime, shownAsUtc } from "../data.ts";

/** An instant and the offset it's shown at, in minutes east of UTC. */
export interface Instant {
	ms: number;
	offset: number;
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

/** What a format string can get wrong, in the liquid crate's words. */
export class DateFormatError extends Error {}

/** Midnight UTC on a day, for any year (`Date.UTC` reads 0 to 99 as 1900 to 1999). */
function utcDay(year: number, month: number, day: number): number {
	const d = new Date(0);
	d.setUTCFullYear(year, month, day);
	return d.getTime();
}

const DAY = 86_400_000;
const mod = (a: number, n: number) => ((a % n) + n) % n;

/** The fields of an instant at its offset. */
function fields(when: Instant) {
	const d = new Date(when.ms + when.offset * 60_000);
	const year = d.getUTCFullYear(), month = d.getUTCMonth() + 1, day = d.getUTCDate();
	const fromMonday = mod(d.getUTCDay() + 6, 7);
	const ordinal = Math.round((utcDay(year, month - 1, day) - utcDay(year, 0, 1)) / DAY) + 1;
	return { year, month, day, hour: d.getUTCHours(), minute: d.getUTCMinutes(), second: d.getUTCSeconds(), nanos: d.getUTCMilliseconds() * 1_000_000, fromMonday, ordinal };
}

/** ISO 8601's week date: the year it belongs to and the week, from 1. */
function isoWeek(year: number, ordinal: number, fromMonday: number): [number, number] {
	const p = (y: number) => mod(y + Math.floor(y / 4) - Math.floor(y / 100) + Math.floor(y / 400), 7);
	const weeks = (y: number) => (p(y) === 4 || p(y - 1) === 3 ? 53 : 52);
	const week = Math.floor((ordinal - (fromMonday + 1) + 10) / 7);
	if (week < 1) return [year - 1, weeks(year - 1)];
	if (week > weeks(year)) return [year + 1, 1];
	return [year, week];
}

type Padding = "default" | "zero" | "space";
type Casing = "default" | "upper" | "change";

/** `when` formatted with `fmt`, as Ruby's `Time#strftime` and 0.7 do it. */
export function strftime(when: Instant, fmt: string): string {
	const t = fields(when);
	const chars = [...fmt];
	let out = "";
	for (let i = 0; i < chars.length; i++) {
		if (chars[i] !== "%") {
			out += chars[i];
			continue;
		}
		const start = i;
		let usePadding = true;
		let padding: Padding = "default";
		let casing: Casing = "default";
		// Flags, each until a later one says otherwise.
		for (;;) {
			const c = chars[i + 1];
			if (c === undefined) throw new DateFormatError("no format specifier following '%'");
			if (c === "-") usePadding = false;
			else if (c === "_") padding = "space";
			else if (c === "0") padding = "zero";
			else if (c === "^") casing = "upper";
			else if (c === "#") casing = "change";
			else break;
			i++;
		}
		let width: number | undefined;
		if (/[0-9]/.test(chars[i + 1])) {
			let digits = "";
			while (/[0-9]/.test(chars[i + 1] ?? "")) digits += chars[++i];
			if (chars[i + 1] === undefined) throw new DateFormatError("no format specifier following '%'");
			width = Number(digits);
			if (!Number.isSafeInteger(width)) throw new DateFormatError(`failed to parse padding width: number too large to fit in target type`);
		}
		let spec = chars[++i];
		if (spec === undefined) throw new DateFormatError("no format specifier following '%'");
		// Ruby reads the E and O modifiers and ignores them.
		if (spec === "E" || spec === "O") {
			spec = chars[++i];
			if (spec === undefined) throw new DateFormatError("no format specifier following '%' with a format modifier");
		}
		const pad = (n: number, char: string) => char.repeat(Math.max(n, 0));
		const alphaPad = () => (padding === "zero" ? "0" : " ");
		const before = out.length;
		/** A composite (`%F`, `%c`): padded to `width` as a whole. */
		const composite = (text: string, size: number) => {
			if (width !== undefined) out += pad(width - size, alphaPad());
			out += text;
			if (casing !== "default") out = out.slice(0, before) + out.slice(before).toUpperCase();
		};
		const numeric = (value: number, defaultWidth: number) => {
			if (usePadding) {
				let digits = value <= 0 ? 1 : 0;
				for (let v = Math.trunc(value); v !== 0; v = Math.trunc(v / 10)) digits++;
				if (value < 0 && padding !== "space") out += "-";
				out += pad((width ?? defaultWidth + (value < 0 ? 1 : 0)) - digits, padding === "space" ? " " : "0");
				if (value < 0 && padding === "space") out += "-";
			} else if (value < 0) out += "-";
			out += String(Math.abs(value));
		};
		const alphabetical = (text: string) => {
			if (usePadding && width !== undefined) out += pad(width - text.length, alphaPad());
			out += text;
			if (casing !== "default") out = out.slice(0, before) + out.slice(before).toUpperCase();
		};
		const two = (n: number) => String(n).padStart(2, "0");
		const hour12 = t.hour === 0 || t.hour === 12 ? 12 : t.hour % 12;
		switch (spec) {
			case "Y": numeric(t.year, 4); break;
			case "C": numeric(Math.trunc(t.year / 100), 2); break;
			case "y": numeric(t.year % 100, 2); break;
			case "m": numeric(t.month, 2); break;
			case "d": case "e":
				if (spec === "e" && padding === "default") padding = "space";
				numeric(t.day, 2);
				break;
			case "w": numeric(mod(t.fromMonday + 1, 7), 0); break;
			case "u": numeric(t.fromMonday + 1, 0); break;
			case "U": numeric(Math.trunc((t.ordinal - mod(t.fromMonday + 1, 7) + 6) / 7), 2); break;
			case "W": numeric(Math.trunc((t.ordinal - t.fromMonday + 6) / 7), 2); break;
			case "G": numeric(isoWeek(t.year, t.ordinal, t.fromMonday)[0], 4); break;
			case "g": numeric(isoWeek(t.year, t.ordinal, t.fromMonday)[0] % 100, 2); break;
			case "V": numeric(isoWeek(t.year, t.ordinal, t.fromMonday)[1], 2); break;
			case "j": numeric(t.ordinal, 3); break;
			case "H": case "k":
				if (spec === "k" && padding === "default") padding = "space";
				numeric(t.hour, 2);
				break;
			case "I": case "l":
				if (spec === "l" && padding === "default") padding = "space";
				numeric(hour12, 2);
				break;
			case "M": numeric(t.minute, 2); break;
			case "S": numeric(t.second, 2); break;
			case "s": numeric(Math.trunc(when.ms / 1000), 0); break;
			case "b": case "h": alphabetical(MONTHS[t.month - 1].slice(0, 3)); break;
			case "B": alphabetical(MONTHS[t.month - 1]); break;
			case "a": alphabetical(WEEKDAYS[t.fromMonday].slice(0, 3)); break;
			case "A": alphabetical(WEEKDAYS[t.fromMonday]); break;
			case "P": case "p": {
				// The case is the other way round from the letter's, as in Ruby.
				const upper = (spec === "p" && casing !== "change") || (spec === "P" && casing !== "default");
				casing = "default";
				alphabetical(t.hour < 12 ? (upper ? "AM" : "am") : (upper ? "PM" : "pm"));
				break;
			}
			case "F": composite(`${String(t.year).padStart(4, "0")}-${two(t.month)}-${two(t.day)}`, 10); break;
			case "v":
				casing = "upper";
				composite(`${String(t.day).padStart(2, " ")}-${MONTHS[t.month - 1].slice(0, 3)}-${String(t.year).padStart(4, "0")}`, 11);
				break;
			case "R": composite(`${two(t.hour)}:${two(t.minute)}`, 5); break;
			case "D": case "x": composite(`${two(t.month)}/${two(t.day)}/${two(t.year % 100)}`, 8); break;
			case "T": case "X": composite(`${two(t.hour)}:${two(t.minute)}:${two(t.second)}`, 8); break;
			case "r": composite(`${two(hour12)}:${two(t.minute)}:${two(t.second)} ${t.hour < 12 ? "AM" : "PM"}`, 11); break;
			case "c": composite(`${WEEKDAYS[t.fromMonday].slice(0, 3)} ${MONTHS[t.month - 1].slice(0, 3)} ${String(t.day).padStart(2, " ")} ${two(t.hour)}:${two(t.minute)}:${two(t.second)} ${String(t.year).padStart(4, "0")}`, 24); break;
			case "%": case "n": case "t":
				if (usePadding && width !== undefined) out += pad(width - 1, alphaPad());
				out += spec === "%" ? "%" : spec === "n" ? "\n" : "\t";
				break;
			case "L": case "N": {
				// The width is the number of digits, and they're filled on the right.
				const digits = width ?? (spec === "L" ? 3 : 9);
				out += String(digits <= 9 ? Math.trunc(t.nanos / 10 ** (9 - digits)) : t.nanos).padEnd(digits, "0");
				break;
			}
			case "z": case "Z": case ":": {
				let hmSep = spec !== "z", msSep = false, known = true;
				if (spec === ":") {
					const next = chars[++i];
					if (next === ":") {
						if (chars[++i] === "z") msSep = true;
						else known = false;
					} else if (next !== "z") known = false;
				}
				if (!known) {
					out += chars.slice(start, i + 1).join("");
					break;
				}
				const size = 1 + 2 + (hmSep ? 1 : 0) + 2 + (msSep ? 3 : 0);
				const hoursWidth = Math.max(Math.max((width ?? 0) - size, 0) + 2, 2);
				const hours = Math.trunc(when.offset / 60), minutes = Math.abs(when.offset % 60);
				if (padding !== "space") out += `${when.offset < 0 ? "-" : "+"}${String(Math.abs(hours)).padStart(hoursWidth, "0")}`;
				else out += `${hours < 0 ? "-" : "+"}${Math.abs(hours)}`.padStart(hoursWidth, " ");
				out += `${hmSep ? ":" : ""}${two(minutes)}`;
				if (msSep) out += ":00";
				break;
			}
			default:
				out += chars.slice(start, i + 1).join("");
		}
	}
	return out;
}

const MONTH_NAMES = new Map(MONTHS.flatMap((name, i) => [[name, i], [name.slice(0, 3), i]] as const));
const WEEKDAY_SHORT = new Set(WEEKDAYS.map((name) => name.slice(0, 3)));

/** An instant from its fields, when they make a real one. */
function instant(year: number, month: number, day: number, hour: number, minute: number, second: number, fraction: string, offset: string): Instant | undefined {
	if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59 || second > 59) return undefined;
	const days = utcDay(year, month - 1, day);
	if (new Date(days).getUTCDate() !== day) return undefined;
	const sign = offset[0] === "-" ? -1 : 1;
	const offsetMinutes = sign * (Number(offset.slice(1, 3)) * 60 + Number(offset.slice(-2)));
	const ms = days + ((hour * 60 + minute - offsetMinutes) * 60 + second) * 1000 + Math.trunc(Number(`0.${fraction || "0"}`) * 1000);
	return { ms, offset: offsetMinutes };
}

/**
 * A string as a date, as 0.7 read one: `now` or `today`, seconds since 1970, or one of the liquid
 * crate's formats (`2024-03-04 10:00:00 +0300`, `13 June 2016 02:30:00`, `06/13/2016 ...`,
 * `Mon Jun 13 02:30:00 2016`), at UTC when it names no offset. ISO 8601 (`2024-03-04`,
 * `2024-03-04T10:00:00Z`) too, which 0.7 left as it was.
 */
export function parseDate(text: string): Instant | undefined {
	const s = text;
	if (s === "") return undefined;
	const lower = s.trim().toLowerCase();
	if (lower === "now" || lower === "today") return { ms: buildTime().getTime(), offset: 0 };
	if (/^[+-]?[0-9]+$/.test(s)) {
		const seconds = Number(s);
		return Number.isSafeInteger(seconds) ? { ms: seconds * 1000, offset: 0 } : undefined;
	}
	let m = /^(-?\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?)?(Z|[+-]\d{2}:?\d{2})?$/.exec(s);
	if (m && (m[4] !== undefined || m[8] === undefined)) {
		const zone = m[8] === undefined || m[8] === "Z" ? "+0000" : m[8].replace(":", "");
		return instant(Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4] ?? 0), Number(m[5] ?? 0), Number(m[6] ?? 0), m[7] ?? "", zone);
	}
	const withOffset = /[+-][01][0-9]{3}$/.test(s) ? s : `${s} +0000`;
	const offset = "([+-]\\d{2}\\d{2})$";
	if ((m = new RegExp(`^(-?\\d{4})-(\\d{2})-(\\d{2}) (\\d{2}):(\\d{2}):(\\d{2})(?:\\.(\\d{1,9}))? ${offset}`).exec(withOffset))) {
		return instant(Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6]), m[7] ?? "", m[8]);
	}
	if ((m = new RegExp(`^(\\d{2}) ([A-Za-z]+) (-?\\d{4}) (\\d{2}):(\\d{2}):(\\d{2}) ${offset}`).exec(withOffset)) && MONTH_NAMES.has(m[2])) {
		return instant(Number(m[3]), MONTH_NAMES.get(m[2])! + 1, Number(m[1]), Number(m[4]), Number(m[5]), Number(m[6]), "", m[7]);
	}
	if ((m = new RegExp(`^(\\d{2})/(\\d{2})/(-?\\d{4}) (\\d{2}):(\\d{2}):(\\d{2}) ${offset}`).exec(withOffset))) {
		return instant(Number(m[3]), Number(m[1]), Number(m[2]), Number(m[4]), Number(m[5]), Number(m[6]), "", m[7]);
	}
	if ((m = new RegExp(`^([A-Za-z]{3}) ([A-Za-z]{3}) (\\d{1,2}) (\\d{2}):(\\d{2}):(\\d{2}) (-?\\d{4}) ${offset}`).exec(withOffset)) && WEEKDAY_SHORT.has(m[1]) && MONTH_NAMES.has(m[2]) && m[2].length === 3) {
		return instant(Number(m[7]), MONTH_NAMES.get(m[2])! + 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6]), "", m[8]);
	}
	return undefined;
}

/** A value as a date, when it is one or reads as one. */
export function toInstant(v: unknown): Instant | undefined {
	if (v instanceof Date) return Number.isNaN(v.getTime()) ? undefined : { ms: shownAsUtc(v).getTime(), offset: 0 };
	if (typeof v === "string") return parseDate(v);
	return undefined;
}

/** How Liquid prints a date: `2026-01-02 00:00:00 +0000`. */
export function showDate(d: Date): string {
	return strftime({ ms: shownAsUtc(d).getTime(), offset: 0 }, "%Y-%m-%d %H:%M:%S %z");
}
