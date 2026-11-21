// `vuePlugin()`'s own parts. Rendering needs the site's Vite and Vue, so the whole plugin is checked
// on a VitePress site (the vuejs.org docs, in the PR that added it), not here.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { packageEntry, routeParams, setupImports } from "./vue.ts";

test("a_pages_script_setup_names_its_components_and_loaders", () => {
	const page = "<script setup>\nimport ApiIndex from './ApiIndex.vue'\nimport { data } from './errors.data'\nimport { data as api } from \"./api.data.ts\"\nimport { ref } from 'vue'\n</script>\n\n```vue\n<script setup>\nimport NotThis from './No.vue'\n</script>\n```\n";
	assert.deepEqual(setupImports(page), { components: { ApiIndex: "./ApiIndex.vue" }, loaders: { data: "./errors.data", api: "./api.data.ts" } });
});

test("a_dynamic_routes_params_come_from_its_url", () => {
	assert.deepEqual(routeParams("partners/[partnerId].md", "/partners/vehikl.html"), { partnerId: "vehikl" });
	assert.deepEqual(routeParams("trails/[region]/[trail].md", "/trails/cascades/cedar/"), { region: "cascades", trail: "cedar" });
	assert.deepEqual(routeParams("guide/intro.md", "/guide/intro.html"), {});
});

test("a_package_is_found_in_the_sites_node_modules", () => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ssqch-vue-"));
	const pkg = (name: string, json: object) => { fs.mkdirSync(path.join(dir, "node_modules", name), { recursive: true }); fs.writeFileSync(path.join(dir, "node_modules", name, "package.json"), JSON.stringify(json)); };
	pkg("vite", { exports: { ".": { import: "./dist/node/index.js", require: "./index.cjs" }, "./package.json": "./package.json" } });
	pkg("@vitejs/plugin-vue", { exports: { ".": { import: { types: "./x.d.mts", default: "./dist/index.mjs" } } } });
	pkg("old", { main: "lib/old.js" });
	fs.mkdirSync(path.join(dir, "site"));
	assert.equal(packageEntry(path.join(dir, "site"), "vite"), path.join(dir, "node_modules/vite/dist/node/index.js"));
	assert.equal(packageEntry(dir, "@vitejs/plugin-vue"), path.join(dir, "node_modules/@vitejs/plugin-vue/dist/index.mjs"));
	assert.equal(packageEntry(dir, "old"), path.join(dir, "node_modules/old/lib/old.js"));
	assert.equal(packageEntry(path.join(dir, "site"), "not-there-at-all"), undefined);
});
