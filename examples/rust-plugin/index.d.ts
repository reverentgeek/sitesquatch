export interface TrailGuideOptions {
	/** What `greet(name)` says first. Default `"Hello"`. */
	greeting?: string;
	/** How fast `readingTime(html)` reads, in words a minute. Default 200. */
	wordsPerMinute?: number;
	/** The `rel` links to other sites get, or `""` to leave them alone. Default `"external"`. */
	externalRel?: string;
}

/** What a Rust plugin's npm package gives ssqch. */
export interface RustPlugin {
	name: string;
	rust: {
		/** The absolute path to the plugin's .wasm file (wasm32-wasip1, ABI 1). */
		wasm: string;
		/** The options, as JSON, for the plugin's `new`. */
		options?: unknown;
	};
}

export default function trailGuide(options?: TrailGuideOptions): RustPlugin;
