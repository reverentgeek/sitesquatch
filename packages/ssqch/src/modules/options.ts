// A built-in plugin's options object, rejecting misspelled keys (0.7's `Options` in `main.rs`).
// The messages are 0.7's word for word: the config names the plugin in front of them.
import { bail } from "../diagnostics.ts";
import { closest } from "../suggest.ts";

export class Options {
	private map: Record<string, unknown>;

	constructor(value: unknown, known: readonly string[]) {
		if (typeof value !== "object" || value === null || Array.isArray(value)) bail("options must be an object");
		// A key whose value is `undefined` isn't there (0.7 read the options as JSON).
		const map = Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined));
		const key = Object.keys(map).find((k) => !known.includes(k));
		if (key !== undefined) {
			if (known.length === 0) bail(`this plugin takes no options (got "${key}")`);
			const meant = closest(key, known);
			bail(`unknown option "${key}"${meant ? ` (did you mean "${meant}"?)` : ""} (options: ${known.join(", ")})`);
		}
		this.map = map;
	}

	/** An option's value, or `undefined` when it's missing or `null`. */
	get(key: string): unknown {
		const v = this.map[key];
		return v === null ? undefined : v;
	}

	string(key: string): string | undefined {
		const v = this.get(key);
		if (v === undefined) return undefined;
		if (typeof v !== "string") bail(`${key} must be a string`);
		return v;
	}

	number(key: string): number | undefined {
		const v = this.get(key);
		if (v === undefined) return undefined;
		if (typeof v !== "number" || !Number.isFinite(v)) bail(`${key} must be a number`);
		return v;
	}

	bool(key: string): boolean | undefined {
		const v = this.get(key);
		if (v === undefined) return undefined;
		if (typeof v !== "boolean") bail(`${key} must be true or false`);
		return v;
	}

	list(key: string): string[] | undefined {
		const v = this.get(key);
		if (v === undefined) return undefined;
		if (!Array.isArray(v) || v.some((i) => typeof i !== "string")) bail(`${key} must be an array of strings`);
		return v;
	}
}
