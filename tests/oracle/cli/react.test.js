// Added in 0.17: `reactPlugin()` from "ssqch/react" renders a site's React components with the
// site's own React, react-dom and esbuild. The repository doesn't install them, so the tests that
// render need a folder that has them: SSQCH_REACT_MODULES, a `node_modules` with react, react-dom
// and esbuild (`npm install --prefix <dir> react react-dom esbuild`, then `<dir>/node_modules`).
// Without it they're skipped, and the error for a site without them is checked either way.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { ssqch, read, tempDir, write } from "../lib/ssqch.js";

const MODULES = process.env.SSQCH_REACT_MODULES ? path.resolve(process.env.SSQCH_REACT_MODULES) : undefined;
const hasReact = MODULES !== undefined && ["react", "react-dom", "esbuild"].every((p) => fs.existsSync(path.join(MODULES, p, "package.json")));
const needsReact = { skip: !hasReact && "needs SSQCH_REACT_MODULES: a node_modules folder with react, react-dom and esbuild" };

/** A site in a new folder with React installed (linked from SSQCH_REACT_MODULES). */
function reactSite(name, files) {
	const dir = tempDir(name);
	write(dir, files);
	fs.symlinkSync(MODULES, path.join(dir, "node_modules"), "junction");
	return dir;
}

const COUNTER = `import { useState } from "react";
import "./Counter.css";
export default function Counter({ start = 0, label = "Pine cones" }) {
	const [count, setCount] = useState(start);
	return <button className="counter" onClick={() => setCount(count + 1)}>{label}: {count}</button>;
}
`;
const TRAIL = `export function Trail({ name, miles, open, style, className, children }) {
	return <section className={className} style={style}><h2>{name} {open ? "open" : "closed"}</h2><p>{miles * 2} half-miles</p>{children}</section>;
}
export function Boom() {
	throw new Error("the trail is closed for bears");
}
`;
const LAYOUT = "<!doctype html>\n<html><head><title>{{ title }}</title></head>\n<body>{{ content | safe }}</body></html>\n";

test("react_plugin_without_react_says_what_to_install", () => {
	const dir = tempDir("react-none");
	write(dir, {
		"package.json": "{ \"name\": \"trail\", \"private\": true }\n",
		"ssqch.config.js": "import { reactPlugin } from \"ssqch/react\";\nexport default { plugins: [reactPlugin()] };\n",
		"index.md": "import Counter from \"./Counter.jsx\"\n\n# Trail\n\n<Counter />\n",
		"Counter.jsx": COUNTER,
	});
	const r = ssqch(["build", "--root", dir]);
	assert.ok(!r.ok && r.log.includes("reactPlugin() needs react, react-dom and esbuild in the site's packages: `npm install react react-dom` and `npm install -D esbuild`"), r.log);
	write(dir, { "ssqch.config.js": "import { reactPlugin } from \"ssqch/react\";\nexport default { plugins: [reactPlugin({ hydrate: \"later\" })] };\n" });
	const bad = ssqch(["build", "--root", dir]);
	assert.ok(!bad.ok && bad.log.includes("hydrate must be false, \"load\", \"idle\" or \"visible\", or an object of them by component ({ Counter: \"visible\" }) (got \"later\")"), bad.log);
	write(dir, { "ssqch.config.js": "import { reactPlugin } from \"ssqch/react\";\nexport default { plugins: [reactPlugin({ hydrat: \"load\" })] };\n" });
	const typo = ssqch(["build", "--root", dir]);
	assert.ok(!typo.ok && typo.log.includes("unknown option \"hydrat\" (did you mean \"hydrate\"?)"), typo.log);
});

test("react_components_render_and_one_runs_in_the_browser", needsReact, () => {
	const dir = reactSite("react-render", {
		"ssqch.config.js": "import { reactPlugin } from \"ssqch/react\";\nexport default { dirs: { input: \"src\" }, markdownEngine: false, plugins: [reactPlugin({ components: { Counter: \"src/components/Counter.jsx\" }, hydrate: { Counter: \"visible\" } })] };\n",
		"src/components/Counter.jsx": COUNTER,
		"src/components/Counter.css": ".counter { color: #233B2B; }\n",
		"src/components/Trail.jsx": TRAIL,
		"src/_includes/base.njk": LAYOUT.replace("</body>", "<footer><Counter label=\"Footer\" /></footer></body>"),
		"src/index.md": "---\ntitle: Cedar\nlayout: base.njk\n---\nimport { Trail } from \"./components/Trail.jsx\"\n\n# Cedar Trail\n\n<Trail name=\"Cedar\" miles={4.5} open={true} style={{ color: \"green\" }} class=\"trail\">\n\nBring **Squatch Snacks**.\n\n</Trail>\n\n<Counter start={3}\n  label=\"Pine cones\" />\n\n```jsx\n<Trail miles={1} />\n```\n",
		"src/plain.md": "---\ntitle: Plain\n---\nimport { Trail } from \"./components/Trail.jsx\"\n\n<Trail name=\"Old Growth\" miles={2} />\n",
	});
	const r = ssqch(["build", "--root", dir]);
	assert.ok(r.ok, r.log);
	const html = read(dir, "_site/index.html");
	// Props as JSX reads them, children as the page's Markdown, and the import line gone.
	assert.ok(html.includes("<section class=\"trail\" style=\"color:green\"><h2>Cedar<!-- --> <!-- -->open</h2><p>9<!-- --> half-miles</p>\n<p>Bring <strong>Squatch Snacks</strong>.</p>\n</section>"), html);
	assert.ok(!html.includes("import") && !html.includes(""), html);
	// The hydrated one, in its island, from the page and from the layout; the code sample stays text.
	assert.match(html, /<ssqch-react data-component="Counter-[0-9a-f]{8}" data-hydrate="visible" data-props="\{&quot;start&quot;:3,&quot;label&quot;:&quot;Pine cones&quot;\}"><button class="counter">Pine cones<!-- -->: <!-- -->3<\/button><\/ssqch-react>/);
	assert.ok(html.includes("<ssqch-react data-component=\"Counter-") && html.includes("Footer<!-- -->: <!-- -->0"), html);
	assert.ok(html.includes("&lt;Trail miles={1} /&gt;"), html);
	assert.ok(html.includes("<script type=\"module\" src=\"/assets/react/islands.js\"></script></body>"), html);
	// A page with no island has no script; its component is HTML only.
	const plain = read(dir, "_site/plain/index.html");
	assert.ok(plain.includes("<section><h2>Old Growth<!-- --> <!-- -->closed</h2><p>4<!-- --> half-miles</p></section>") && !plain.includes("<script"), plain);
	assert.equal(read(dir, "_site/assets/react.css").includes(".counter"), true);
	assert.ok(fs.existsSync(path.join(dir, "_site/assets/react/islands.js")));
});

test("a_react_component_that_throws_points_at_its_tag", needsReact, () => {
	const dir = reactSite("react-throws", {
		"ssqch.config.js": "import { reactPlugin } from \"ssqch/react\";\nexport default { markdownEngine: false, plugins: [reactPlugin()] };\n",
		"Trail.jsx": TRAIL,
		"index.md": "---\ntitle: Bears\n---\nimport { Boom, Trail } from \"./Trail.jsx\"\n\n# Bears\n\n<Trail name=\"Cedar\" />\n\n<Boom />\n",
	});
	const r = ssqch(["build", "--root", dir, "--format", "json"]);
	assert.ok(!r.ok);
	const report = JSON.parse(r.stdout);
	assert.deepEqual(report.errors, [{ code: "template", message: "reactPlugin(): <Boom> (Trail.jsx) at index.md:10 didn't render: the trail is closed for bears", file: "index.md", line: 10 }]);
	// A misspelled tag says which the page has.
	write(dir, { "index.md": "import { Trail } from \"./Trail.jsx\"\n\n<Trial name=\"Cedar\" />\n" });
	const typo = ssqch(["build", "--root", dir]);
	assert.ok(!typo.ok && typo.log.includes("reactPlugin(): <Trial> at index.md:3 isn't a component this page has (did you mean <Trail>?)") && typo.log.includes("--> index.md:3"), typo.log);
});
