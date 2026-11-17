// `ssqch/elements`. Its plugin is ported with stage 5 of the move to Node (docs/node-migration.md); until
// then the module is here so a config that imports it loads, and the build says what's missing.
import { notYet } from "./not-yet.ts";

export function elementsPlugin(options: Record<string, unknown> = {}) {
	return { name: "ssqch/elements", builtin: "ssqch/elements", options };
}
