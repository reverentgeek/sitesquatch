// `ssqch/image`. Its plugin is ported with stage 5 of the move to Node (docs/node-migration.md); until
// then the module is here so a config that imports it loads, and the build says what's missing.
import { notYet } from "./not-yet.ts";

export function imagePlugin(options: Record<string, unknown> = {}) {
	return { name: "ssqch/image", builtin: "ssqch/image", options };
}

export const image = (..._args: unknown[]): never => notYet("image", "ssqch/image");

export const imageUrl = (..._args: unknown[]): never => notYet("imageUrl", "ssqch/image");
