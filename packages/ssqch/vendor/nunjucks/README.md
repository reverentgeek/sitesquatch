# ssqch's fork of nunjucks

ssqch renders `.njk`, `.jinja` and `.j2` templates with [nunjucks](https://github.com/mozilla/nunjucks) (decision D1 in `docs/node-migration.md`). nunjucks 3.2.4 was published in April 2023 and not since, so ssqch keeps its own copy here and owns it: the package as npm serves it, plus the changes below. The package keeps the name `nunjucks` (`"nunjucks": "file:vendor/nunjucks"` in `packages/ssqch/package.json`), so `import nunjucks from "nunjucks"`, `@types/nunjucks` and a bundler find it as they did. The license is nunjucks' own, in `LICENSE` (BSD-2-Clause).

What's here: `index.js` and `src/`, as published (the published `src/` is nunjucks' own ES2015 source compiled by Babel, which is what Node runs). Left out: `bin/` (the `nunjucks-precompile` command, which needed `commander`) and `browser/` (prebuilt bundles, which wouldn't carry these changes). `git log -p packages/ssqch/vendor/nunjucks` shows the fork: its first commit is the published copy, and every change after it is ssqch's. Each change is marked with a comment that starts `ssqch:`.

## What changed, and why

Errors that point at the spot:

- **A filter or a test that isn't there, or that throws, names its line** (`compiler.js`, `compileFilter`, `compileFilterAsync`, `compileIs`). The compiled code kept track of the line only at function calls, so `{{ title | uper }}` was reported at the line of the last call before it, or at none.
- **A template that isn't there names the line of the tag that wanted it** (`_compileGetTemplate`), and an error that arrives through a callback (a missing include, an async filter that failed) gets a line at all (`_makeCallback`, which now passes it through `runtime.handleError`).
- **A runtime error's line isn't one short** (`runtime.js`, `handleError`). The compiled code counts lines from 0 and a `TemplateError` from 1, as the parser's errors do; runtime errors were reported a line early.

Jinja that read as something else:

- **`{% for key in object %}` goes through the keys**, as in Jinja (`compileFor`). It went through nothing.
- **`{% set ns.found = true %}` sets an attribute** (`compileSet`), so Jinja's `namespace()` works; it stopped the compiler with a JavaScript error.
- **Jinja's loop filter, `{% for x in xs if x.ok %}`, is an error** (`parser.js`, `parseFor`). It read as `xs if x.ok`, which runs before `x` is set and loops over every item: an answer quietly different from Jinja's.

Everything else ssqch adds (its filters, tests, globals, tags from a site's functions, how values print and escape) is in `packages/ssqch/src/engines/nunjucks.ts`, through nunjucks' own API.

## Updating

There's nothing upstream to take: nunjucks' repository has had no release since 3.2.4. A security fix found there would be applied here by hand, with a comment, like the changes above.
