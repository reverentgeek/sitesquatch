// From crates/ssqch/tests/cli.rs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { ssqch, expectedVersion } from "../lib/ssqch.js";

test("version_names_the_binary", () => {
	const r = ssqch(["--version"]);
	assert.ok(r.ok, r.log);
	assert.equal(r.stdout, `ssqch ${expectedVersion()}\n`);
});
