// `path` cases checked against Node. Regenerate the expected output with:
//   node crates/sitesquatch-js/tests/fixtures/path-cases.mjs > crates/sitesquatch-js/tests/fixtures/path-expected.json
import path from "node:path";
const inputs = ["", ".", "..", "/", "//", "a", "a/", "/a", "/a/", "a/b/c", "/a/b/c/", "a//b", "./a/./b/../c", "../a/../../b", "/../a", "a/b/../..", "a/b/../../..", "foo.txt", ".bashrc", "a/b.c.d", "a.b/c", "/x/y.tar.gz", "dir/.hidden", "file.", "a/b/"];
const out = {};
for (const fn of ["normalize", "dirname", "basename", "extname", "isAbsolute"]) out[fn] = inputs.map((p) => path[fn](p));
out.parse = inputs.map((p) => path.parse(p));
out.join = [["a", "b"], ["/a", "../b"], ["a", "", "b"], ["", ""], ["a/", "/b/"], ["..", "a"], ["/", "a", "..", ".."]].map((a) => path.join(...a));
out.resolveRel = [["a"], ["src", "../lib"], ["/a", "b"], ["/a", "/b", "c"], ["/a/b", "..", ".."], ["/a/b/", "./c/"]].map((a) => { const r = path.resolve(...a); return r.startsWith(process.cwd()) ? "<cwd>" + r.slice(process.cwd().length) : r; });
out.relative = [["/a/b/c", "/a/d"], ["/a", "/a"], ["/a/b", "/a/b/c/d"], ["/x", "/y/z"], ["/", "/a"]].map(([a, b]) => path.relative(a, b));
out.basenameExt = [["a/b.txt", ".txt"], ["b.txt", "b.txt"], ["x.js", "js"], ["/a/b/", "b"], ["b/", "b"], ["b//", "b"], ["a/b.txt/", ".txt"], ["a/b.txt//", "b.txt"], ["/b", "b"], ["a/bb/", "b"], ["a/xb/", "b"], ["b", "b"], ["./b", "b"], ["x/b.txt", "b.txt"], ["/b.txt", "b.txt"], ["b.txt/", "b.txt"]].map(([a, b]) => path.basename(a, b));
out.format = [{ dir: "/a", base: "b.txt" }, { root: "/", base: "b" }, { name: "x", ext: ".js" }, { dir: "/", base: "a" }, { root: "/", dir: "/home", name: "f", ext: ".md" }].map((o) => path.format(o));
export default out;
if (process.argv?.[1]?.endsWith("path-cases.mjs")) console.log(JSON.stringify(out));
