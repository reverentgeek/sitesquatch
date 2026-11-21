// What a site gets from `import ... from "ssqch"`: the module ssqch.d.ts declares, and none of
// the build's own helpers. Each file in this folder is one of ssqch's modules, as a site imports
// it (`src/modules.ts` resolves them here, and the npm package builds `lib/*.js` from them);
// `capabilities.test.ts` checks that each exports exactly what ssqch.d.ts declares.
export { default, defineConfig, files, markdown, readData, safe, slugger, slugify } from "../api.ts";
