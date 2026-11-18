// Node's `WebAssembly`, typed. TypeScript's types for it come with the DOM's, which this package
// doesn't load (a browser's globals would type-check in Node code), so these are the parts ssqch
// uses.

export interface WasmModule {
	readonly __module: unique symbol;
}

export interface WasmMemory {
	readonly buffer: ArrayBuffer;
}

export type WasmImports = Record<string, Record<string, unknown>>;

interface WebAssemblyGlobal {
	Module: {
		new (bytes: Uint8Array): WasmModule;
		customSections(module: WasmModule, name: string): ArrayBuffer[];
	};
	Instance: new (module: WasmModule, imports: WasmImports) => { readonly exports: Record<string, unknown> };
	/** What a trap (a panic in Rust, `unreachable`) throws. */
	RuntimeError: new (message?: string) => Error;
}

export const WebAssembly = (globalThis as unknown as { WebAssembly: WebAssemblyGlobal }).WebAssembly;
