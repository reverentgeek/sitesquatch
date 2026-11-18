// The completion scripts are 0.7's, as clap made them from the same command line
// (`bundled/completions/`). If the grammar gains a command or an option, a script has to as well.
import { test } from "node:test";
import assert from "node:assert/strict";
import { bundled } from "./bundled.ts";
import { GRAMMAR } from "./cli.ts";

test("completion_scripts_name_every_command_and_option", () => {
	for (const shell of ["bash", "elvish", "fish", "powershell", "zsh"]) {
		const script = bundled(`completions/${shell}`);
		for (const command of GRAMMAR.commands.filter((c) => !c.hidden)) {
			assert.ok(script.includes(command.name), `${shell}: no \`${command.name}\``);
			for (const option of command.options) assert.ok(script.includes(option.long), `${shell}: no --${option.long} for \`${command.name}\``);
		}
		for (const option of GRAMMAR.globals) assert.ok(script.includes(option.long), `${shell}: no --${option.long}`);
	}
});
