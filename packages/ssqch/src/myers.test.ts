// From the tests of the `similar` crate (3.2.1), whose Myers this is.
import { test } from "node:test";
import assert from "node:assert/strict";
import { diffOps } from "./myers.ts";
import type { Op } from "./myers.ts";

const range = (from: number, to: number) => Array.from({ length: to - from }, (_, i) => from + i);
const equalLen = (ops: Op[]) => ops.reduce((n, op) => n + (op.tag === "equal" ? op.oldLen : 0), 0);

/** The script turns `old` into `next`: its runs follow each other, and the equal ones are equal. */
function applies(old: number[], next: number[], ops: Op[]): boolean {
	let o = 0, n = 0;
	for (const op of ops) {
		if (op.oldIndex !== o || op.newIndex !== n) return false;
		if (op.tag === "equal") for (let k = 0; k < op.oldLen; k++) if (old[o + k] !== next[n + k]) return false;
		o += op.oldLen;
		n += op.newLen;
	}
	return o === old.length && n === next.length;
}

test("a_change_in_the_middle_is_a_replacement", () => {
	assert.deepEqual(diffOps([0, 1, 2, 3, 4], [0, 1, 2, 9, 4]), [
		{ tag: "equal", oldIndex: 0, oldLen: 3, newIndex: 0, newLen: 3 },
		{ tag: "replace", oldIndex: 3, oldLen: 1, newIndex: 3, newLen: 1 },
		{ tag: "equal", oldIndex: 4, oldLen: 1, newIndex: 4, newLen: 1 },
	]);
	assert.deepEqual(diffOps([], []), []);
	assert.deepEqual(diffOps([1, 2], []), [{ tag: "delete", oldIndex: 0, oldLen: 2, newIndex: 0, newLen: 0 }]);
});

test("the_reduction_keeps_a_sparse_match", () => {
	const old = range(0, 4096);
	const next = range(10_000, 14_096);
	next[2048] = old[1024];
	assert.deepEqual(diffOps(old, next), [
		{ tag: "replace", oldIndex: 0, oldLen: 1024, newIndex: 0, newLen: 2048 },
		{ tag: "equal", oldIndex: 1024, oldLen: 1, newIndex: 2048, newLen: 1 },
		{ tag: "replace", oldIndex: 1025, oldLen: 3071, newIndex: 2049, newLen: 2047 },
	]);
	const shorter = range(0, 1024);
	const other = range(10_000, 11_024);
	other[512] = shorter[256];
	assert.equal(equalLen(diffOps(shorter, other)), 1);
});

test("the_reduction_keeps_a_chain_of_anchors", () => {
	const old = range(0, 4096);
	const next = range(10_000, 14_096);
	next[0] = old[0];
	next[4095] = old[4095];
	for (const [o, n] of [[100, 200], [500, 700], [900, 1200], [1500, 1800], [2400, 2700], [3500, 3600]]) next[n] = old[o];
	assert.equal(equalLen(diffOps(old, next)), 8);
});

test("a_short_side_is_matched_exactly", () => {
	assert.deepEqual(diffOps([1], range(10, 1010)), [{ tag: "replace", oldIndex: 0, oldLen: 1, newIndex: 0, newLen: 1000 }]);
	const old = range(0, 8);
	const next = range(1000, 2000);
	next[500] = 0;
	assert.ok(diffOps(old, next).some((op) => op.tag === "equal" && op.oldIndex === 0 && op.newIndex === 500 && op.oldLen === 1));
	const ops = diffOps(range(0, 1000), [500]);
	assert.ok(ops.some((op) => op.tag === "equal" && op.oldIndex === 500 && op.newIndex === 0));
	assert.equal(ops.reduce((n, op) => n + op.oldLen, 0) - 1, 999);
});

test("every_script_turns_the_old_into_the_new", () => {
	let seed = 42;
	const random = (n: number) => {
		seed = (seed * 1103515245 + 12345) % 2147483648;
		return seed % n;
	};
	for (let round = 0; round < 300; round++) {
		const size = [5, 40, 300, 1500][round % 4];
		const alphabet = [2, 8, 50, 100_000][random(4)];
		const old = Array.from({ length: random(size) }, () => random(alphabet));
		const next = round % 3 === 0 ? old.map((v) => (random(10) === 0 ? random(alphabet) : v)).filter(() => random(20) !== 0) : Array.from({ length: random(size) }, () => random(alphabet));
		const ops = diffOps(old, next);
		assert.ok(applies(old, next, ops), `round ${round}`);
		// Runs of one kind next to each other are one run, and a deletion next to an insertion is a replacement.
		for (let i = 1; i < ops.length; i++) {
			const pair = `${ops[i - 1].tag} ${ops[i].tag}`;
			assert.ok(ops[i].tag !== ops[i - 1].tag && pair !== "delete insert" && pair !== "insert delete", `round ${round}: ${pair}`);
		}
	}
});
