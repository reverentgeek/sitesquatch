// What a build is doing, for `ssqch serve`'s limit on a build that's stopped making progress: a
// promise in the site's code that never settles, while something else keeps Node running (a
// `setInterval` in the config), wedged every rebuild after it with no word (from the move to
// Node). The build's process says what it's waiting on each second (`build-process.ts`), and the
// server ends a build that's waited a minute with nothing done (`builder.ts`).
//
// Progress is anything finishing or starting: a page written, an image encoded, a piece of the
// site's code (a hook, a filter, a data file) starting or settling. So the limit counts from the
// last thing the build did, not its start, and a long first build (images) never meets it.
//
// No imports: `modules.ts`, which every command loads, marks the site's code with it.

let last = performance.now();
let next = 0;
const waiting = new Map<number, string>();
/** The page being rendered, for a label (`rendering.ts` sets it, which `modules.ts` shouldn't load). */
let pageOf: () => string | undefined = () => undefined;
/** The build process's way to tell the server, before something that holds the event loop (`aboutToBlock`). */
let tell: ((label: string) => Promise<void>) | undefined;

export function setPageOf(fn: () => string | undefined): void {
	pageOf = fn;
}

export function setTell(fn: ((label: string) => Promise<void>) | undefined): void {
	tell = fn;
}

/** Something the build did: a page written, an image encoded. */
export function progressed(): void {
	last = performance.now();
}

/**
 * The site's code is running, and the build waits for it: `label` says what (`filter \`slow\``,
 * `afterBuild hook (ssqch.config.js)`), with the page being rendered. Answers the function to call
 * when it has settled.
 */
export function waitingOn(label: string): () => void {
	const page = pageOf();
	const id = next++;
	waiting.set(id, page ? `${label} (rendering ${page})` : label);
	last = performance.now();
	return () => {
		waiting.delete(id);
		last = performance.now();
	};
}

/** Promises `tracked` gave, so one awaited again further on (an engine awaiting a filter's) is said once, by its first label. */
const marked = new WeakSet<Promise<unknown>>();

/** `promise`, marked as the site's code the build waits on. */
export function tracked<T>(promise: Promise<T>, label: string): Promise<T> {
	if (marked.has(promise)) return promise;
	const done = waitingOn(label);
	const out = promise.finally(done);
	marked.add(out);
	return out;
}

/**
 * Before something that holds the event loop for as long as it runs (a `run` command, through
 * `spawnSync`): the server is told first, so it doesn't take the silence for a build that's stuck.
 */
export async function aboutToBlock(label: string): Promise<void> {
	last = performance.now();
	await tell?.(label);
}

/** How long since the build last did anything, and what it's waiting on, oldest first. */
export function current(): { idleMs: number; doing: string[] } {
	return { idleMs: Math.round(performance.now() - last), doing: [...waiting.values()] };
}

/** A new build: nothing waited on, and the clock from now. */
export function reset(): void {
	waiting.clear();
	last = performance.now();
}
