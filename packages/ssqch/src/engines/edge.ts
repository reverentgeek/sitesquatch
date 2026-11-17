// Edge, for `.edge`: the edge.js library itself.
//
// STAGE 2 of the move to Node has the engine in its plainest form, so the core can be checked
// with the oracle's tests (most of them render with Edge). Stage 3 finishes it: compiled
// templates kept by file (`renderRawSync` compiles on every call), includes from themes, async
// functions awaited as 0.7 awaited them, `strict`, and errors as ssqch says them.
import { Edge } from "edge.js";
import { BuildError } from "../diagnostics.ts";
import { describeThrown } from "../modules.ts";
import { siteFunction } from "./engine.ts";
import type { EngineEnv, TemplateEngine } from "./engine.ts";

export function edgeEngine(env: EngineEnv): TemplateEngine {
	const edge = Edge.create({ cache: true });
	// Includes and components come from the site's includes folder.
	edge.mount(env.dirs.includes);
	for (const [name, fn] of env.globals) edge.global(name, siteFunction(name, fn, env.config.root));
	return {
		render(source, data, ctx) {
			try {
				return edge.renderRawSync(source, data);
			} catch (e: any) {
				if (e instanceof BuildError) throw e;
				const line = typeof e?.line === "number" ? `:${e.line}` : "";
				throw new BuildError(`${ctx.name}${line}: ${describeThrown(e, env.config.root)}`);
			}
		},
	};
}
