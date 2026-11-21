// Which page is rendering, for the config's functions: `this.page` and `this.data` in a filter
// (a `function`, not an arrow) are the page being rendered and the data its template sees, in
// every template language. Renders of different pages can overlap (an async filter, Edge), so
// it's kept per render with AsyncLocalStorage rather than in a variable.
//
// And `safe(html)`, which marks a function's answer as HTML to print as it is: four fresh moves
// (MkDocs' and Hugo's themes) had a filter whose HTML printed escaped, and built safe strings by
// hand from the prototype of a layout's `content`.
import { AsyncLocalStorage } from "node:async_hooks";
import nunjucks from "nunjucks";
import type { Data } from "./data.ts";

/** What's rendering: the data the template sees (a layout's, while the layouts render). */
export interface Rendering { data: Data }

const store = new AsyncLocalStorage<Rendering>();

/** Runs `fn` as the render of `rendering`, so the config's functions it calls see it. */
export function renderingAs<T>(rendering: Rendering, fn: () => T): T {
	return store.run(rendering, fn);
}

/** The render that's running, if one is. */
export const currentRendering = (): Rendering | undefined => store.getStore();

/**
 * The config's function `fn`, called with `this` as `{ page, data }` while a page renders (and
 * `undefined` otherwise: in a collection, a data file, a hook). Its name and length are `fn`'s.
 */
export function withPage<F extends (...args: any[]) => any>(fn: F): F {
	const wrapped = function (this: unknown, ...args: unknown[]) {
		const rendering = store.getStore();
		return fn.apply(rendering ? { page: rendering.data.page, data: rendering.data } : undefined, args);
	};
	Object.defineProperty(wrapped, "name", { value: fn.name });
	Object.defineProperty(wrapped, "length", { value: fn.length });
	return wrapped as unknown as F;
}

const SafeString = nunjucks.runtime.SafeString as unknown as new (text: string) => String;
// Handlebars prints what has a `toHTML()` as it is.
(SafeString.prototype as unknown as { toHTML(): string }).toHTML = function (this: String) { return String(this); };

/** `safe(html)`: text that templates print as it is, without escaping it. It's a string to everything else. */
export function safe(html: unknown): String {
	return html instanceof SafeString ? html : new SafeString(html === undefined || html === null ? "" : String(html));
}

/** Whether `value` is marked safe (a layout's `content`, `| safe`, `safe()`). */
export const isSafe = (value: unknown): boolean => value instanceof SafeString;
