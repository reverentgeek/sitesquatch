// The command line's grammar: commands, their options and arguments, `--help`, and the errors
// for a line that doesn't fit. The words and the layout are the 0.7 binary's (which were clap's),
// since scripts and coding agents read them.

export interface Option {
	/** `--format`. */
	long: string;
	/** `-o`. */
	short?: string;
	/** The value's name in help (`FORMAT`); a flag has none. */
	value?: string;
	help: string;
	/** Shown in help as `[default: text]`. */
	default?: string;
	/** May be given more than once. */
	many?: boolean;
	/** Checks a value and says what's wrong with it, or nothing. */
	check?: (value: string) => string | undefined;
	/** The values it takes, listed in help and in the error for another. */
	values?: string[];
	/** A path: an empty value is refused, as clap refused one for a `PathBuf`. */
	path?: boolean;
}

export interface Positional {
	/** `PATH`. */
	name: string;
	help: string;
	required: boolean;
	values?: string[];
	/** Shown in help as `[default: .]`; the command applies it. */
	default?: string;
	/** Takes the rest of the words (the last positional only). */
	many?: boolean;
	/** A path: an empty value is refused. */
	path?: boolean;
}

export interface Command {
	name: string;
	about: string;
	options: Option[];
	positionals: Positional[];
	/** Text after the options in `--help`. */
	afterHelp?: string;
	/** Left out of `--help` and completions. */
	hidden?: boolean;
	/** Takes anything after its name as it is (its own parsing). */
	raw?: boolean;
}

export interface Parsed {
	command: string | undefined;
	/** Options by their long name: a flag is `true`, a value its text, a repeatable one a list. */
	options: Record<string, string | boolean | string[]>;
	positionals: string[];
}

/** A line that doesn't fit: `message` is everything to print, and the exit code is clap's 2. */
export class UsageError extends Error {
	/** What kind of word was refused, for the hint from the table of other generators' words. */
	refused?: { word: string; kind: "command" | "flag" };
	constructor(message: string, refused?: UsageError["refused"]) {
		super(message);
		this.refused = refused;
	}
}

/** `--help` or `--version` was asked for: `text` goes to standard output, and the exit code is 0. */
export class Printed extends Error {
	text: string;
	constructor(text: string) {
		super("printed");
		this.text = text;
	}
}

export interface Grammar {
	name: string;
	about: string;
	version: string;
	/** Options every command takes, before or after its name. */
	globals: Option[];
	commands: Command[];
}

const HELP: Option = { long: "help", short: "h", help: "Print help" };
const VERSION: Option = { long: "version", short: "V", help: "Print version" };

const optionLabel = (o: Option) => `${o.short ? `-${o.short}, ` : "    "}--${o.long}${o.value ? ` <${o.value}>` : ""}`;
const usageOf = (grammar: Grammar, command: Command | undefined) => {
	if (!command) return `Usage: ${grammar.name} [OPTIONS] [COMMAND]`;
	const args = command.positionals.map((p) => (p.required ? `<${p.name}>` : `[${p.name}]`) + (p.many ? "..." : ""));
	return `Usage: ${grammar.name} ${command.name} ${["[OPTIONS]", ...args].join(" ")}`;
};

/** A table of two columns, the second starting two spaces after the widest first. */
function table(rows: Array<[string, string]>): string {
	const width = Math.max(...rows.map(([left]) => left.length));
	return rows.map(([left, right]) => `  ${left.padEnd(width)}  ${right}`.trimEnd()).join("\n");
}

/** `--help` for the whole program, or for one command. */
export function help(grammar: Grammar, command?: Command): string {
	const describe = (o: Option) => o.help + (o.default !== undefined ? ` [default: ${o.default}]` : "") + (o.values ? ` [possible values: ${o.values.join(", ")}]` : "");
	if (!command) {
		const commands: Array<[string, string]> = grammar.commands.filter((c) => !c.hidden).map((c) => [c.name, c.about]);
		commands.push(["help", "Print this message or the help of the given subcommand(s)"]);
		const options: Array<[string, string]> = [...grammar.globals, HELP, VERSION].map((o) => [optionLabel(o), describe(o)]);
		return `${grammar.about}\n\n${usageOf(grammar, undefined)}\n\nCommands:\n${table(commands)}\n\nOptions:\n${table(options)}\n`;
	}
	let out = `${command.about}\n\n${usageOf(grammar, command)}\n`;
	if (command.positionals.length) {
		out += `\nArguments:\n${table(command.positionals.map((p) => [(p.required ? `<${p.name}>` : `[${p.name}]`) + (p.many ? "..." : ""), p.help + (p.default !== undefined ? ` [default: ${p.default}]` : "") + (p.values ? ` [possible values: ${p.values.join(", ")}]` : "")]))}\n`;
	}
	out += `\nOptions:\n${table([...command.options, ...grammar.globals, HELP].map((o) => [optionLabel(o), describe(o)]))}\n`;
	if (command.afterHelp) out += `\n${command.afterHelp}\n`;
	return out;
}

/**
 * The long help, which `ssqch docs <command>` prints: each argument and option on its own with
 * its text below it, and a default or the possible values after a blank line, as clap's long
 * help lays them out. `--help` itself is the short layout.
 */
export function longHelp(grammar: Grammar, command: Command): string {
	const entry = (label: string, text: string, notes: string[]) => `  ${label}\n          ${text}\n${notes.length ? `          \n${notes.map((n) => `          ${n}\n`).join("")}` : ""}`;
	const notesOf = (o: { default?: string; values?: string[] }) => [...(o.default !== undefined ? [`[default: ${o.default}]`] : []), ...(o.values ? [`[possible values: ${o.values.join(", ")}]`] : [])];
	let out = `${command.about}\n\n${usageOf(grammar, command)}\n`;
	if (command.positionals.length) {
		out += `\nArguments:\n${command.positionals.map((p) => entry((p.required ? `<${p.name}>` : `[${p.name}]`) + (p.many ? "..." : ""), p.help, notesOf(p))).join("\n")}`;
	}
	out += `\nOptions:\n${[...command.options, ...grammar.globals, HELP].map((o) => entry(optionLabel(o), o.help, notesOf(o))).join("\n")}`;
	if (command.afterHelp) out += `\n${command.afterHelp}\n`;
	return out;
}

/** How alike two words are, from 0 to 1 (Jaro's measure, which clap's tips use). */
function jaro(a: string, b: string): number {
	if (a === b) return 1;
	if (!a.length || !b.length) return 0;
	const range = Math.max(0, Math.floor(Math.max(a.length, b.length) / 2) - 1);
	const inA = new Array<boolean>(a.length).fill(false), inB = new Array<boolean>(b.length).fill(false);
	let matches = 0;
	for (let i = 0; i < a.length; i++) {
		for (let j = Math.max(0, i - range); j < Math.min(b.length, i + range + 1); j++) {
			if (inB[j] || a[i] !== b[j]) continue;
			inA[i] = inB[j] = true;
			matches++;
			break;
		}
	}
	if (!matches) return 0;
	let transpositions = 0;
	for (let i = 0, j = 0; i < a.length; i++) {
		if (!inA[i]) continue;
		while (!inB[j]) j++;
		if (a[i] !== b[j]) transpositions++;
		j++;
	}
	return (matches / a.length + matches / b.length + (matches - transpositions / 2) / matches) / 3;
}

/** The words like `word`, the likeliest last. */
function similar(word: string, candidates: string[]): string[] {
	return candidates.map((c) => [jaro(word, c), c] as const).filter(([score]) => score > 0.7).sort((x, y) => x[0] - y[0]).map(([, c]) => c);
}

const tail = "For more information, try '--help'.\n";

/** Reads a command line (without the program's name). Throws `Printed` for `--help` and `--version`, and `UsageError` for a line that doesn't fit. */
/** clap's tip for a value close to one of `values` (`tcsh` for `zsh`), with the blank line after it, or nothing. */
function similarValue(value: string, values: string[]): string {
	const like = similar(value, values).pop();
	return like ? `  tip: a similar value exists: '${like}'\n\n` : "";
}

export function parse(grammar: Grammar, argv: string[]): Parsed {
	const out: Parsed = { command: undefined, options: {}, positionals: [] };
	let command: Command | undefined;
	const find = (test: (o: Option) => boolean): Option | undefined => command?.options.find(test) ?? grammar.globals.find(test) ?? [HELP, ...(command ? [] : [VERSION])].find(test);
	const usage = () => usageOf(grammar, command);
	// The options given so far, as clap listed them in the usage line after an unknown flag or a
	// missing argument (`Usage: ssqch build --root <ROOT> --quiet`).
	const used: string[] = [];
	const usageUsed = () => (command && used.length ? `Usage: ${grammar.name} ${command.name} ${used.join(" ")}` : usage());
	const required = (option: Option) => new UsageError(`error: a value is required for '--${option.long} <${option.value}>' but none was supplied\n\n${tail}`);
	const set = (option: Option, value: string | true, shown: string) => {
		if (option === HELP) throw new Printed(help(grammar, command));
		if (option === VERSION) throw new Printed(`${grammar.name} ${grammar.version}\n`);
		if (typeof value === "string") {
			const label = `'--${option.long} <${option.value}>'`;
			if (value === "" && option.path) throw required(option);
			if (option.values && !option.values.includes(value)) throw new UsageError(`error: invalid value '${value}' for ${label}\n  [possible values: ${option.values.join(", ")}]\n\n${similarValue(value, option.values)}${tail}`);
			const wrong = option.check?.(value);
			if (wrong !== undefined) throw new UsageError(`error: invalid value '${value}' for ${label}: ${wrong}\n\n${tail}`);
		}
		if (option.many) {
			const list = (out.options[option.long] ??= []) as string[];
			list.push(value as string);
		} else {
			if (option.long in out.options) throw new UsageError(`error: the argument '${shown}' cannot be used multiple times\n\n${usage()}\n\n${tail}`);
			out.options[option.long] = value;
		}
		const named = `--${option.long}${option.value ? ` <${option.value}>` : ""}`;
		if (!used.includes(named)) used.push(named);
	};
	const unexpected = (arg: string, tips: string[] = []): never => {
		const flag = arg.split("=")[0];
		const body = tips.length ? `${tips.map((t) => `  tip: ${t}`).join("\n")}\n\n` : "";
		throw new UsageError(`error: unexpected argument '${arg.startsWith("-") ? flag : arg}' found\n\n${body}${arg.startsWith("-") ? usageUsed() : usage()}\n\n${tail}`, arg.startsWith("-") ? { word: flag, kind: "flag" } : undefined);
	};

	/** The value of `option` from the word after it (at `at + 1`). A word that starts with a dash isn't a value: it's another option, or one nobody knows. */
	const valueAfter = (option: Option, at: number): string => {
		const next = argv[at + 1];
		if (next === undefined) throw required(option);
		if (!next.startsWith("-") || next === "-") return next;
		const name = next.split("=")[0];
		if (find((o) => (name.startsWith("--") ? o.long === name.slice(2) : o.short === name[1]))) throw required(option);
		return unexpected(next, command?.positionals.length ? [`to pass '${next}' as a value, use '-- ${next}'`] : []);
	};

	let onlyPositionals = false;
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (command?.raw) { out.positionals.push(arg); continue; }
		if (onlyPositionals || arg === "-" || !arg.startsWith("-")) {
			if (!command && !onlyPositionals) {
				if (arg === "help") {
					const name = argv[i + 1];
					if (name === "help") throw new Printed(`Print this message or the help of the given subcommand(s)\n\nUsage: ${grammar.name} help [COMMAND]...\n\nArguments:\n  [COMMAND]...  Print help for the subcommand(s)\n`);
					const about = name === undefined ? undefined : grammar.commands.find((c) => c.name === name);
					if (name !== undefined && !about) throw new UsageError(`error: unrecognized subcommand '${name}'\n\n${usage()}\n\n${tail}`);
					// A command has no subcommands, so a word after its name is one it doesn't have.
					const more = argv[i + 2];
					if (about && more !== undefined) throw new UsageError(`error: unrecognized subcommand '${more}'\n\n${usageOf(grammar, about)}\n\n${tail}`);
					throw new Printed(help(grammar, about));
				}
				command = grammar.commands.find((c) => c.name === arg);
				if (!command) {
					const like = similar(arg, grammar.commands.filter((c) => !c.hidden).map((c) => c.name));
					const tip = like.length === 1 ? `  tip: a similar subcommand exists: '${like[0]}'\n\n` : like.length ? `  tip: some similar subcommands exist: ${like.map((c) => `'${c}'`).join(", ")}\n\n` : "";
					throw new UsageError(`error: unrecognized subcommand '${arg}'\n\n${tip}${usage()}\n\n${tail}`, { word: arg, kind: "command" });
				}
				out.command = command.name;
				continue;
			}
			if (!command || (out.positionals.length >= command.positionals.length && !command.positionals.at(-1)?.many)) unexpected(arg);
			const positional = command!.positionals[Math.min(out.positionals.length, command!.positionals.length - 1)];
			if (arg === "" && positional.path) throw new UsageError(`error: a value is required for '${positional.required ? `<${positional.name}>` : `[${positional.name}]`}' but none was supplied\n\n${tail}`);
			if (positional.values && !positional.values.includes(arg)) throw new UsageError(`error: invalid value '${arg}' for '<${positional.name}>'\n  [possible values: ${positional.values.join(", ")}]\n\n${similarValue(arg, positional.values)}${tail}`);
			out.positionals.push(arg);
			continue;
		}
		if (arg === "--") { onlyPositionals = true; continue; }
		if (arg.startsWith("--")) {
			const eq = arg.indexOf("=");
			const name = eq === -1 ? arg.slice(2) : arg.slice(2, eq);
			const option = find((o) => o.long === name);
			if (!option) {
				const longs = [...(command?.options ?? []), ...grammar.globals, HELP].map((o) => o.long);
				const like = similar(name, longs).pop();
				unexpected(arg, like ? [`a similar argument exists: '--${like}'`] : command?.positionals.length ? [`to pass '${arg}' as a value, use '-- ${arg}'`] : []);
			}
			if (!option!.value) {
				if (eq !== -1) throw new UsageError(`error: unexpected value '${arg.slice(eq + 1)}' for '--${name}' found; no more were expected\n\n${usage()}\n\n${tail}`);
				set(option!, true, `--${name}`);
				continue;
			}
			let value: string | undefined = eq === -1 ? undefined : arg.slice(eq + 1);
			if (value === undefined) value = valueAfter(option!, i++);
			set(option!, value, `--${name} <${option!.value}>`);
			continue;
		}
		// Short options, which can share a dash: `-qv`, `-o dist`, `-odist`, `-o=dist`.
		for (let j = 1; j < arg.length; j++) {
			const letter = arg[j];
			const option = find((o) => o.short === letter);
			if (!option) unexpected(j === 1 ? arg : `-${letter}`);
			if (!option!.value) { set(option!, true, `--${option!.long}`); continue; }
			let value: string | undefined = arg.slice(j + 1);
			if (value.startsWith("=")) value = value.slice(1);
			if (value === "") value = valueAfter(option!, i++);
			set(option!, value, `--${option!.long} <${option!.value}>`);
			break;
		}
	}
	if (command && !command.raw) {
		const missing = command.positionals.slice(out.positionals.length).filter((p) => p.required);
		// The usage line here is the options given, then the arguments, as 0.7 printed it.
		const needed = `Usage: ${grammar.name} ${command.name} ${[...used, ...command.positionals.map((p) => (p.required ? `<${p.name}>` : `[${p.name}]`))].join(" ")}`;
		if (missing.length) throw new UsageError(`error: the following required arguments were not provided:\n${missing.map((p) => `  <${p.name}>`).join("\n")}\n\n${needed}\n\n${tail}`);
	}
	return out;
}
