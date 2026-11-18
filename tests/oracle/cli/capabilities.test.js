// From crates/ssqch/tests/cli.rs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { ssqch, tempDir, write, read, expectedVersion, hasCapability, RUST_07 } from "../lib/ssqch.js";

const names = (value) => value.map((v) => v);

test("capabilities_match_what_a_config_can_use", () => {
	let r = ssqch(["capabilities", "--format", "json"]);
	assert.ok(r.ok);
	let caps;
	try { caps = JSON.parse(r.stdout); } catch (e) { throw new Error(`${e.message}: ${r.stdout}`); }
	assert.equal(caps.schemaVersion, 1);
	assert.equal(caps.version, expectedVersion());
	for (const [key, expected] of [["commands", "inspect"], ["configOptions", "dirs"], ["configOptions", "plugins"], ["nodeModules", "node:fs"], ["globals", "URL"], ["imageFormats", "webp"]]) {
		const list = key === "nodeModules" ? names(caps[key].available) : names(caps[key]);
		assert.ok(list.some((n) => n === expected), `${key} lacks ${expected}: ${JSON.stringify(list)}`);
	}
	assert.equal(caps.features.avif, hasCapability("avif"));
	assert.equal(names(caps.imageFormats).includes("avif"), hasCapability("avif"));
	// 0.7's QuickJS had stand-ins for some Node modules (`node:http` loads and throws when used). On Node every
	// module is Node's own, so none is a stub: `node:http` is available, and `stubs` stays in the report, empty.
	if (RUST_07) assert.ok(names(caps.nodeModules.stubs).includes("node:http") && !names(caps.nodeModules.available).includes("node:http"));
	else assert.ok(names(caps.nodeModules.stubs).length === 0 && names(caps.nodeModules.available).includes("node:http"));
	// What a site gets without a config, and what a starter can be written in, the default first.
	const def = hasCapability("jinja") ? "jinja" : "edge";
	assert.deepEqual(caps.defaults, { templateFormats: [def, "md", "html"], markdownEngine: def, htmlEngine: def });
	assert.equal(names(caps.starterEngines)[0], def);
	assert.ok(names(caps.starterEngines).includes("edge"));

	// Every command it lists is one, and it lists them all.
	const help = ssqch(["--help"]).stdout;
	const lines = help.split("\n");
	const start = lines.findIndex((l) => l.startsWith("Commands:"));
	const listed = [];
	for (const l of lines.slice(start + 1)) {
		if (l.trim() === "") break;
		const first = l.trim().split(/\s+/)[0];
		if (first && first !== "help") listed.push(first);
	}
	assert.deepEqual([...names(caps.commands)].sort(), [...listed].sort());

	// A config that uses everything it says is there: each module with its
	// exports, each Node module, each global and each config option.
	const dir = tempDir("capabilities");
	write(dir, { "src/index.md": "Hi\n" });
	let config = "";
	let checks = "";
	caps.modules.forEach((module, i) => {
		config += `import * as m${i} from ${JSON.stringify(module.name)};\n`;
		for (const exp of module.exports) {
			checks += `if (typeof m${i}[${JSON.stringify(exp)}] !== "function") throw new Error(${JSON.stringify(module.name)} + " lacks " + ${JSON.stringify(exp)});\n`;
		}
		// And nothing else: a module's own helpers aren't part of it (`ssqch` has a default export besides).
		checks += `{ const extra = Object.keys(m${i}).filter((k) => k !== "default" && !${JSON.stringify(module.exports)}.includes(k)); if (extra.length) throw new Error(${JSON.stringify(module.name)} + " also exports " + extra.join(", ")); }\n`;
		assert.ok(module.exports.length > 0, `${module.name} exports nothing`);
	});
	const node = [...names(caps.nodeModules.available), ...names(caps.nodeModules.stubs)];
	node.forEach((name, i) => { config += `import * as n${i} from "${name}";\n`; });
	for (const global of names(caps.globals)) {
		checks += `if (typeof ${global} === "undefined") throw new Error("no ${global}");\n`;
	}
	// An option the config doesn't know would be an error; `undefined` leaves each as it is.
	const options = names(caps.configOptions).map((o) => (o === "dirs" ? "dirs: { input: \"src\", output: \"dist\" }" : `${o}: undefined`));
	config += checks;
	config += `export default { ${options.join(", ")} };\n`;
	write(dir, { "ssqch.config.js": config });
	r = ssqch(["build", "--quiet", "--root", dir]);
	assert.ok(r.ok, `${r.log}\n${config}`);

	// Each template language renders a file with each of its extensions.
	const formats = [];
	for (const language of caps.templateLanguages) {
		for (const ext of names(language.extensions)) {
			write(dir, { [`src/page-${ext}.${ext}`]: "language test\n" });
			// `.markdown` files come with `md`.
			if (ext !== "markdown") formats.push(`"${ext}"`);
		}
	}
	write(dir, { "ssqch.config.js": `export default { dirs: { input: "src", output: "dist" }, templateFormats: [${formats.join(", ")}] };\n` });
	r = ssqch(["build", "--quiet", "--root", dir]);
	assert.ok(r.ok, r.log);
	for (const language of caps.templateLanguages) {
		for (const ext of names(language.extensions)) {
			const page = read(dir, `dist/page-${ext}/index.html`);
			assert.ok(page.includes("language test"), `${ext}: ${page}`);
		}
	}

	r = ssqch(["capabilities"]);
	const text = r.stdout;
	assert.ok(r.ok && text.startsWith(`What's in the pack: ssqch ${expectedVersion()}\n  Commands           build, serve, `) && text.includes("\n  Template languages edge (.edge), markdown (.md, .markdown), html (.html)"), text);
	assert.ok(text.includes(`\n  Defaults           templateFormats ${def}, md, html; Markdown and HTML through ${def}\n`), text);
	r = ssqch(["capabilities", "--format", "xml"]);
	assert.ok(!r.ok && r.log.includes("--format xml: use text or json"), r.log);
});
