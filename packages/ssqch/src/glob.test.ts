// ssqch's globs read as 0.7's did (the globset crate for the config's globs, `diff --only` and
// schemas' `files`, and the collection API's own reading for `byGlob`). The expected matches and
// errors here are what 0.7's binary gave, through `ssqch diff --only`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { globBase, globProblem, globSet, globToRegExp } from "./glob.ts";

const PATHS = ["a.txt", "x/a.txt", "x/y/a.txt", "br/{y}.txt", "br/[x.txt", "é.txt", "ä.txt", "x*.txt", "a,b.txt", "]x.txt"];
// Globs are read as on Linux and macOS unless a test says Windows.
const matching = (glob: string, options = {}) => PATHS.filter((p) => globToRegExp(glob, { windows: false, ...options }).test(p));

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

test("a backslash escapes the next character, as in globset", () => {
	assert.deepEqual(matching("br/\\{y\\}.txt"), ["br/{y}.txt"]);
	assert.deepEqual(matching("br/\\[x.txt"), ["br/[x.txt"]);
	assert.deepEqual(matching("x\\/*"), ["x/a.txt"]);
	assert.deepEqual(matching("x\\*.txt"), ["x*.txt"]);
	// On Windows it's a folder separator instead, as globset has it there.
	assert.deepEqual(matching("x\\*", { windows: true }), ["x/a.txt"]);
	assert.deepEqual(matching("br\\[[]x.txt", { windows: true }), ["br/[x.txt"]);
});

test("`**` as globset reads it", () => {
	// The whole glob `**/` (or `**`, or `**/**`) is every path.
	assert.deepEqual(matching("**/"), PATHS);
	assert.deepEqual(matching("**/**"), PATHS);
	assert.deepEqual(matching("x/**"), ["x/a.txt", "x/y/a.txt"]);
	assert.deepEqual(matching("x/{**,y}/a.txt"), ["x/y/a.txt"]);
	assert.ok(globToRegExp("x/**/a.txt").test("x/a.txt") && globToRegExp("x/**/a.txt").test("x/y/a.txt"));
	assert.ok(globToRegExp("/**").test("/a") && !globToRegExp("/**").test("a"));
});

test("a path is matched as its UTF-8 bytes, as in 0.7", () => {
	// `?` is one byte, so a two-byte letter takes two.
	assert.deepEqual(matching("?.txt"), ["a.txt"]);
	assert.deepEqual(matching("??.txt"), ["é.txt", "ä.txt", "x*.txt", "]x.txt"]);
	// A class's members are bytes too, so a letter of two bytes never matches one.
	assert.deepEqual(matching("[é].txt"), []);
	assert.deepEqual(matching("[à-é].txt"), []);
	// Case is ignored for ASCII letters only.
	assert.ok(globToRegExp("[A-B].JPG", { ignoreCase: true }).test("b.jpg"));
	assert.ok(!globToRegExp("É.jpg", { ignoreCase: true }).test("é.jpg"));
});

test("classes, alternates and commas as globset reads them", () => {
	assert.deepEqual(matching("[]]x.txt"), ["]x.txt"]);
	assert.deepEqual(matching("{,a}.txt"), ["a.txt"]);
	assert.deepEqual(matching("a,b.txt"), ["a,b.txt"]);
	assert.ok(globToRegExp("[a-].txt").test("-.txt") && globToRegExp("[!]].txt").test("a.txt") && !globToRegExp("[!]].txt").test("].txt"));
	assert.ok(globToRegExp("{a,{b,ab}}.txt").test("ab.txt"));
});

test("a glob that can't be read says why", () => {
	assert.equal(globProblem("[a"), "unclosed character class; missing ']'");
	assert.equal(globProblem("[]"), "unclosed character class; missing ']'");
	assert.equal(globProblem("[!]"), "unclosed character class; missing ']'");
	assert.equal(globProblem("{a,b"), "unclosed alternate group; missing '}' (maybe escape '{' with '[{]'?)");
	assert.equal(globProblem("a}"), "unopened alternate group; missing '{' (maybe escape '}' with '[}]'?)");
	assert.equal(globProblem("{a,b}}"), "unopened alternate group; missing '{' (maybe escape '}' with '[}]'?)");
	assert.equal(globProblem("[z-a]"), "invalid range; 'z' > 'a'");
	assert.equal(globProblem("[z--]"), "invalid range; 'z' > '-'");
	assert.equal(globProblem("a\\", { windows: false }), "dangling '\\'");
	assert.equal(globProblem("a\\", { windows: true }), undefined);
	// What globset reads, though it looks unfinished.
	assert.equal(globProblem("br/\\[x.txt", { windows: false }), undefined);
	assert.equal(globProblem("src/**/*.{png,jpg}"), undefined);
	assert.throws(() => globSet("ignore", ["[a"]), /^BuildError: ignore: invalid glob "\[a": error parsing glob '\[a': unclosed character class; missing '\]'$/);
});

test("a glob's fixed part", () => {
	assert.equal(globBase("src/_img/**/*.png"), "src/_img");
	assert.equal(globBase("*.png"), "");
	assert.equal(globBase("./assets/img/*.png"), "assets/img");
});
