// The reference page: every name `ssqch docs` lists (the commands, config options, template
// functions and module exports), with its one line and a link to the page that explains it.
// The names, their lines and where each is explained come from `ssqch docs` itself (its
// module, from this repository), so the page answers as the command does.
import { GRAMMAR } from "../../../packages/ssqch/src/cli.ts";
import { answer, names, sections } from "../../../packages/ssqch/src/commands/docs.ts";
import { readmeUrl, slug } from "../../lib/split.ts";

/** The first sentence, outside code spans: the card's line. */
function firstSentence(text) {
	let code = false;
	for (let i = 0; i < text.length; i++) {
		if (text[i] === "`") code = !code;
		if (text[i] === "." && !code && (text[i + 1] === " " || i === text.length - 1)) return text.slice(0, i + 1);
	}
	return text;
}

export default function () {
	const all = sections();
	const known = names(GRAMMAR).filter((n) => n.kind !== "flag");
	// A command's answer is its --help; the README's section about it is where it's written as a name.
	const prose = known.filter((n) => n.kind !== "command");
	const where = (name) => {
		const found = answer(GRAMMAR, all, known, name)?.section ?? answer(GRAMMAR, all, prose, name)?.section;
		return found === undefined ? undefined : { title: all[found].title, url: readmeUrl(slug(all[found].title)) };
	};
	const entry = (n) => ({ name: n.name, id: `${n.kind.replace(/ /g, "-")}-${n.module ? `${n.module.replace(/\W+/g, "-")}-` : ""}${n.name}`, summary: firstSentence(n.summary).replace(/([^.!?])$/, "$1."), where: where(n.name) });
	const groups = [
		{ title: "Commands", prefix: "ssqch ", names: known.filter((n) => n.kind === "command").map(entry) },
		{ title: "Config options", names: known.filter((n) => n.kind === "config option").map(entry) },
		{ title: "Template functions", names: known.filter((n) => n.kind === "template function").map(entry) },
	];
	const modules = [...new Set(known.filter((n) => n.kind === "module export").map((n) => n.module))];
	for (const module of modules) groups.push({ title: `From "${module}"`, names: known.filter((n) => n.kind === "module export" && n.module === module).map(entry) });
	// The page is this Markdown, rendered, and its copy for agents is this Markdown as it is
	// (lib/agents.ts), so the two can't say different things.
	const lines = [`Every name \`ssqch docs\` knows, ${known.length} of them, with its one line from where it's defined (\`ssqch.d.ts\`, the command line, the template functions) and the page that explains it. In a project with ssqch installed, \`ssqch docs <name>\` answers for the version you have.`];
	for (const group of groups) {
		lines.push("", `## ${group.title}`, "");
		for (const n of group.names) lines.push(`- \`${group.prefix ?? ""}${n.name}\`: ${n.summary}${n.where ? ` See [${n.where.title}](${n.where.url}).` : ""}`);
	}
	return { groups, count: known.length, markdown: `${lines.join("\n")}\n` };
}
