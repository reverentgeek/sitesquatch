// ssqch's globs read as 0.7's did (the globset crate for the config's globs, and the collection
// API's own reading for `byGlob`).
import { test } from "node:test";
import assert from "node:assert/strict";
import { globBase, globProblem, globSet, globToRegExp } from "./glob.ts";

test("globs match whole paths", () => {
	const matches = (glob: string, path: string, options = {}) => globToRegExp(glob, options).test(path);
	assert.ok(matches("drafts/**", "drafts/a/b.md") && !matches("drafts/**", "drafts.md"));
	assert.ok(matches("**/README.md", "README.md") && matches("**/README.md", "a/b/README.md"));
	assert.ok(matches("src/*.md", "src/a.md") && !matches("src/*.md", "src/a/b.md"));
	assert.ok(matches("./src/notes/**/*.md", "src/notes/a.md") && matches("src/notes/**/*.md", "src/notes/deep/b.txt.md"));
	assert.ok(matches("src/posts/{pine,yogurt}.md", "src/posts/pine.md") && !matches("src/posts/{pine,yogurt}.md", "src/posts/brittle.md"));
	assert.ok(matches("src/notes/?.md", "src/notes/a.md") && !matches("src/notes/?.md", "src/notes/ab.md"));
	assert.ok(matches("a[!bc].md", "ad.md") && !matches("a[!bc].md", "ab.md"));
	assert.ok(matches("images/*.png", "images/A.PNG", { ignoreCase: true }) && !matches("images/*.png", "images/A.PNG"));
	// `**` that isn't a whole part of the path is `*` twice, except in the collection API.
	assert.ok(!matches("a**", "a/a.md") && matches("a**", "ab.md") && matches("a**", "a/a.md", { loose: true }));
});

test("a glob that can't be read says why", () => {
	assert.equal(globProblem("[a"), "unclosed character class; missing ']'");
	assert.equal(globProblem("{a,b"), "unclosed alternate group; missing '}' (maybe escape '{' with '[{]'?)");
	assert.equal(globProblem("a}"), "unopened alternate group; missing '{' (maybe escape '}' with '[}]'?)");
	assert.equal(globProblem("[z-a]"), "invalid range; 'z' > 'a'");
	assert.equal(globProblem("src/**/*.{png,jpg}"), undefined);
	assert.throws(() => globSet("ignore", ["[a"]), /^BuildError: ignore: invalid glob "\[a": error parsing glob '\[a': unclosed character class; missing '\]'$/);
});

test("a glob's fixed part", () => {
	assert.equal(globBase("src/_img/**/*.png"), "src/_img");
	assert.equal(globBase("*.png"), "");
	assert.equal(globBase("./assets/img/*.png"), "assets/img");
});
