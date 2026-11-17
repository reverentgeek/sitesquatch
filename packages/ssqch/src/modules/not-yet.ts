// What a function of a built-in module says until its stage of the move to Node ports it.
import { BuildError } from "../diagnostics.ts";

export function notYet(name: string, module: string): never {
	throw new BuildError(`${name}() from "${module}" isn't in the Node build of ssqch yet (the move to Node, stage 5)`);
}
