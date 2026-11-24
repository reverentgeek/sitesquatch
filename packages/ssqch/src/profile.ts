// Where a build's time goes: `ssqch build --profile`, and the `slow-call` warning.
//
// Every move to ssqch found its slow code by wrapping functions by hand: the summary said
// `write 1.42 s`, or `write 23 s`, and named nothing. With `--profile`, the build times every
// filter, transform, template engine, layout, data file, data function, collection and hook it
// calls, and every page and template it renders, and the report lists them, slowest first. A
// call's time is from the moment it's made until it returns (or, for a promise, until it
// settles), so it includes the calls it makes: a template engine's time has its filters' in it.
//
// Without `--profile`, the site's own filters, transforms and collections (not ssqch's) are still
// timed one call at a time, and one that takes a second or more is a `slow-call` warning at the
// end of the build, naming it, where it's from and the page it was working on: those run for
// every page, so a second each is minutes (an HTML minifier as a transform took 5.2 s a page in
// a migration). Data functions and hooks run once a build, and a long one (a fetch, Pagefind)
// is often the point, so they're timed only with `--profile`.
import { warning } from "./diagnostics.ts";
import type { Diagnostic } from "./diagnostics.ts";

/** A call this long or longer is a `slow-call` warning, when it's the site's own. */
export const SLOW_MS = 1000;

/** What the profile groups its times by, in the order the report lists them. */
export const KINDS = ["pages", "templates", "layouts", "engines", "filters", "transforms", "data", "collections", "hooks"] as const;
export type Kind = (typeof KINDS)[number];

/** How a warning names one of a kind. */
const SINGULAR: Record<Kind, string> = { pages: "page", templates: "template", layouts: "layout", engines: "template engine", filters: "filter", transforms: "transform", data: "data", collections: "collection", hooks: "hook" };

interface Stat {
	calls: number;
	ms: number;
	/** The site's own (a `slow-call` is reported for it), not ssqch's. */
	own: boolean;
	/** Where it's defined, when that's known: `ssqch.config.js`, `plugin "toc"`. */
	from?: string;
	/** Calls that took `SLOW_MS` or more, and the first of them: its time and the page it was working on. The first, not the slowest, so the warning names the same page every build. */
	slowCalls: number;
	firstSlow?: number;
	firstSlowAt?: string;
	/** A call returned a promise, timed until it settled: calls that ran at once overlap. */
	async: boolean;
}

/** One line of a profile's list: a name, how many calls, their total time, and whether any call was async (its time overlaps others'). */
export interface ProfileEntry {
	name: string;
	calls: number;
	ms: number;
	async: boolean;
}

export type ProfileReport = Record<Kind, ProfileEntry[]>;

/**
 * How long ssqch's own work that a site's function waits on has been in progress (`image()`
 * encoding a picture), as one clock: the time when at least one such wait was pending. A call
 * subtracts what this clock gained while it ran before it's judged slow, so a filter that asks
 * for another crop isn't blamed for the AVIF encoder's second on a cold build (the company-site
 * example on CI). Its time in `--profile` still includes it, as it includes any call it makes.
 */
export const ssqchWork = {
	pending: 0,
	since: 0,
	total: 0,
	now(): number {
		return this.total + (this.pending ? performance.now() - this.since : 0);
	},
	async wait<T>(work: Promise<T>): Promise<T> {
		if (this.pending++ === 0) this.since = performance.now();
		try {
			return await work;
		} finally {
			if (--this.pending === 0) this.total += performance.now() - this.since;
		}
	},
};

const isPromise = (v: unknown): v is Promise<unknown> => typeof (v as { then?: unknown } | null)?.then === "function";

export class Profile {
	/** `--profile`: time everything. Otherwise only the site's own functions, for `slow-call`. */
	readonly detailed: boolean;
	/** The page being rendered, which a slow call is said to be working on (pages render one at a time). */
	at: string | undefined;
	private stats = new Map<Kind, Map<string, Stat>>(KINDS.map((k) => [k, new Map()]));

	constructor(detailed: boolean) {
		this.detailed = detailed;
	}

	/** Records one call of `name`, which took `ms`. */
	add(kind: Kind, name: string, ms: number, own: boolean, from?: string, at = this.at, async = false, waited = 0): void {
		// Slow is the call's own time, without ssqch's work it waited on.
		const slow = ms - waited >= SLOW_MS;
		if (!this.detailed && !(own && slow)) return;
		const of = this.stats.get(kind)!;
		let stat = of.get(name);
		if (!stat) of.set(name, stat = { calls: 0, ms: 0, own, from, slowCalls: 0, async: false });
		stat.calls++;
		if (async) stat.async = true;
		stat.ms += ms;
		if (slow && stat.slowCalls++ === 0) [stat.firstSlow, stat.firstSlowAt] = [ms, at];
	}

	/** Runs `call` and records its time, until it returns or, for a promise, settles. */
	time<T>(kind: Kind, name: string, own: boolean, call: () => T, from?: string): T {
		const at = this.at;
		const start = performance.now();
		const work = ssqchWork.now();
		const out = call();
		if (isPromise(out)) {
			const done = () => this.add(kind, name, performance.now() - start, own, from, at, true, ssqchWork.now() - work);
			out.then(done, done);
		} else this.add(kind, name, performance.now() - start, own, from, at, false, ssqchWork.now() - work);
		return out;
	}

	/** `fn`, timed whenever it's called (with the `this` it's called with: Nunjucks passes its context). */
	wrap<F extends (...args: any[]) => any>(kind: Kind, name: string, fn: F, own: boolean, from?: string): F {
		const profile = this;
		return function (this: unknown, ...args: unknown[]) {
			return profile.time(kind, name, own, () => fn.apply(this, args), from);
		} as F;
	}

	/** Whether a function of this kind is timed: every one with `--profile`, the site's own without. */
	times(own: boolean): boolean {
		return this.detailed || own;
	}

	/** The `slow-call` warnings: one for each of the site's own functions with a call of a second or more. */
	slowCalls(): Diagnostic[] {
		const out: Diagnostic[] = [];
		for (const kind of KINDS) {
			for (const [name, s] of this.stats.get(kind)!) {
				if (!s.own || s.slowCalls === 0) continue;
				const what = kind === "hooks" ? name : `${SINGULAR[kind]} \`${name}\``;
				const from = s.from ? ` (from ${s.from})` : "";
				const at = s.firstSlowAt ? ` working on ${s.firstSlowAt}` : "";
				const more = s.slowCalls > 1 ? `, the first of ${s.slowCalls} calls that took over a second` : "";
				out.push(warning("slow-call", `${what}${from} took ${seconds(s.firstSlow!)}${at}${more}. \`ssqch build --profile\` shows where a build's time goes`));
			}
		}
		return out;
	}

	/** Every kind's list, slowest first (by total time, then name). Empty without `--profile`. */
	report(): ProfileReport {
		const out = {} as ProfileReport;
		for (const kind of KINDS) {
			const list = this.detailed ? [...this.stats.get(kind)!].map(([name, s]) => ({ name, calls: s.calls, ms: s.ms, async: s.async })) : [];
			out[kind] = list.sort((a, b) => b.ms - a.ms || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
		}
		return out;
	}
}

/** `1.4 s`, as a warning says it. */
const seconds = (ms: number) => `${(ms / 1000).toFixed(1)} s`;
