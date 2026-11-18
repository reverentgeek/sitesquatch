// The diff algorithm behind `ssqch diff`: a port of what 0.7 used, the `similar` crate's
// `capture_diff_slices(Algorithm::Myers, ...)` at 3.2.1. That's Myers' algorithm with linear
// space (the middle snake), Git's heuristics for expensive inputs, a pass that leaves out lines
// with no match before the search, an exact search when one side is small, and the cleanup that
// slides changes together and pairs a deletion with the insertion next to it as a replacement.
//
// Several edit scripts are often equally short, and which one an implementation picks decides
// how a diff's hunks are split. So this follows `similar` step for step rather than being any
// Myers: the same inputs give 0.7's hunks. The items are numbers (ssqch interns its tokens and
// lines), compared with `===`.

/** One run of the edit script: `oldIndex`/`newIndex` and the lengths on each side (a deletion inserts nothing, an insertion deletes nothing). */
export interface Op {
	tag: "equal" | "delete" | "insert" | "replace";
	oldIndex: number;
	oldLen: number;
	newIndex: number;
	newLen: number;
}

type Seq = ArrayLike<number>;

interface Hook {
	equal(oldIndex: number, newIndex: number, len: number): void;
	delete(oldIndex: number, oldLen: number, newIndex: number): void;
	insert(oldIndex: number, newIndex: number, newLen: number): void;
	replace(oldIndex: number, oldLen: number, newIndex: number, newLen: number): void;
	finish(): void;
}

/** The edit script that turns `old` into `next`, as `similar` captured it: equal runs, and deletions, insertions and replacements. */
export function diffOps(old: Seq, next: Seq): Op[] {
	const capture = new Capture();
	const compact = new Compact(new Replace(capture), old, next);
	diff(compact, old, 0, old.length, next, 0, next.length);
	return capture.ops;
}

// ---- hooks -----------------------------------------------------------------------------------

class Capture implements Hook {
	ops: Op[] = [];
	equal(oldIndex: number, newIndex: number, len: number) { this.ops.push({ tag: "equal", oldIndex, oldLen: len, newIndex, newLen: len }); }
	delete(oldIndex: number, oldLen: number, newIndex: number) { this.ops.push({ tag: "delete", oldIndex, oldLen, newIndex, newLen: 0 }); }
	insert(oldIndex: number, newIndex: number, newLen: number) { this.ops.push({ tag: "insert", oldIndex, oldLen: 0, newIndex, newLen }); }
	replace(oldIndex: number, oldLen: number, newIndex: number, newLen: number) { this.ops.push({ tag: "replace", oldIndex, oldLen, newIndex, newLen }); }
	finish() {}
}

/** Joins deletions and insertions into blocks, and a deletion next to an insertion into a replacement. */
class Replace implements Hook {
	d: Hook;
	del: [number, number, number] | undefined;
	ins: [number, number, number] | undefined;
	eq: [number, number, number] | undefined;
	constructor(d: Hook) {
		this.d = d;
	}
	private flushEq() {
		if (this.eq) {
			const [o, n, len] = this.eq;
			this.eq = undefined;
			this.d.equal(o, n, len);
		}
	}
	private flushDelIns() {
		if (this.del) {
			const [o, ol, n] = this.del;
			this.del = undefined;
			if (this.ins) {
				const [, insNew, insLen] = this.ins;
				this.ins = undefined;
				this.d.replace(o, ol, insNew, insLen);
			} else this.d.delete(o, ol, n);
		} else if (this.ins) {
			const [o, n, nl] = this.ins;
			this.ins = undefined;
			this.d.insert(o, n, nl);
		}
	}
	equal(oldIndex: number, newIndex: number, len: number) {
		this.flushDelIns();
		this.eq = this.eq ? [this.eq[0], this.eq[1], this.eq[2] + len] : [oldIndex, newIndex, len];
	}
	delete(oldIndex: number, oldLen: number, newIndex: number) {
		this.flushEq();
		this.del = this.del ? [this.del[0], this.del[1] + oldLen, this.del[2]] : [oldIndex, oldLen, newIndex];
	}
	insert(oldIndex: number, newIndex: number, newLen: number) {
		this.flushEq();
		this.ins = this.ins ? [this.ins[0], this.ins[1], this.ins[2] + newLen] : [oldIndex, newIndex, newLen];
	}
	replace(oldIndex: number, oldLen: number, newIndex: number, newLen: number) {
		this.flushEq();
		this.d.replace(oldIndex, oldLen, newIndex, newLen);
	}
	finish() {
		this.flushEq();
		this.flushDelIns();
		this.d.finish();
	}
}

// An op as the cleanup moves it: one index and one length on each side, which `similar` keeps
// as `old_index`, `new_index` and `len` (a deletion's `new_index` and an insertion's
// `old_index` are where the other side's cursor is).
const EQUAL = 0, DELETE = 1, INSERT = 2;
interface Move {
	tag: number;
	oldIndex: number;
	newIndex: number;
	len: number;
}
const oldStart = (op: Move) => op.oldIndex;
const oldEnd = (op: Move) => op.oldIndex + (op.tag === INSERT ? 0 : op.len);
const newStart = (op: Move) => op.newIndex;
const newEnd = (op: Move) => op.newIndex + (op.tag === DELETE ? 0 : op.len);
const isEmpty = (op: Move) => oldEnd(op) <= oldStart(op) && newEnd(op) <= newStart(op);
const adjust = (op: Move, offset: number, len: number) => { op.oldIndex += offset; op.newIndex += offset; op.len += len; };
const shiftLeft = (op: Move, n: number) => adjust(op, -n, 0);
const shiftRight = (op: Move, n: number) => adjust(op, n, 0);
const growLeft = (op: Move, n: number) => adjust(op, -n, n);
const growRight = (op: Move, n: number) => adjust(op, 0, n);
const shrinkLeft = (op: Move, n: number) => adjust(op, 0, -n);
const shrinkRight = (op: Move, n: number) => adjust(op, n, -n);

/** Collects the script, then slides each change up and down to join it with others like it. */
class Compact implements Hook {
	d: Hook;
	ops: Move[] = [];
	old: Seq;
	next: Seq;
	constructor(d: Hook, old: Seq, next: Seq) {
		this.d = d;
		this.old = old;
		this.next = next;
	}
	equal(oldIndex: number, newIndex: number, len: number) { this.ops.push({ tag: EQUAL, oldIndex, newIndex, len }); }
	delete(oldIndex: number, oldLen: number, newIndex: number) { this.ops.push({ tag: DELETE, oldIndex, newIndex, len: oldLen }); }
	insert(oldIndex: number, newIndex: number, newLen: number) { this.ops.push({ tag: INSERT, oldIndex, newIndex, len: newLen }); }
	replace(oldIndex: number, oldLen: number, newIndex: number, newLen: number) {
		this.delete(oldIndex, oldLen, newIndex);
		this.insert(oldIndex, newIndex, newLen);
	}
	finish() {
		const { ops, old, next } = this;
		shiftAll(ops, old, next);
		normalizeCursors(ops);
		for (const op of ops) {
			if (op.tag === EQUAL) this.d.equal(op.oldIndex, op.newIndex, op.len);
			else if (op.tag === DELETE) this.d.delete(op.oldIndex, op.len, op.newIndex);
			else this.d.insert(op.oldIndex, op.newIndex, op.len);
		}
		this.d.finish();
	}
}

function shiftAll(ops: Move[], old: Seq, next: Seq): void {
	// First the deletions, then the insertions.
	for (const tag of [DELETE, INSERT]) {
		let pointer = 0;
		while (pointer < ops.length) {
			if (ops[pointer].tag === tag) {
				pointer = shiftUp(ops, old, next, pointer);
				pointer = shiftDown(ops, old, next, pointer);
			}
			pointer += 1;
		}
	}
}

function normalizeCursors(ops: Move[]): void {
	if (!ops.length) return;
	let oldCursor = oldStart(ops[0]);
	let newCursor = newStart(ops[0]);
	for (const op of ops) {
		if (op.tag === EQUAL) {
			oldCursor = op.oldIndex + op.len;
			newCursor = op.newIndex + op.len;
		} else if (op.tag === DELETE) {
			op.newIndex = newCursor;
			oldCursor = op.oldIndex + op.len;
		} else {
			op.oldIndex = oldCursor;
			newCursor = op.newIndex + op.len;
		}
	}
}

function swapAdjacent(ops: Move[], left: number): void {
	const right = left + 1;
	const oStart = oldStart(ops[left]);
	const oEnd = oldEnd(ops[right]);
	const nStart = newStart(ops[left]);
	const nEnd = newEnd(ops[right]);
	[ops[left], ops[right]] = [ops[right], ops[left]];
	if (ops[left].tag === INSERT) ops[left].oldIndex = oStart;
	else ops[left].newIndex = nStart;
	if (ops[right].tag === INSERT) ops[right].oldIndex = oEnd;
	else ops[right].newIndex = nEnd;
}

const copy = (op: Move): Move => ({ ...op });

function shiftUp(ops: Move[], old: Seq, next: Seq, pointer: number): number {
	while (pointer >= 1 && pointer - 1 < ops.length) {
		const prev = copy(ops[pointer - 1]);
		const self = copy(ops[pointer]);
		if ((self.tag === INSERT || self.tag === DELETE) && prev.tag === EQUAL) {
			if (self.tag === DELETE && !(pointer >= 2 && ops[pointer - 2]?.tag === DELETE)) break;
			// How far it can move: the common end of the equal run and the change.
			const suffix = self.tag === INSERT
				? commonSuffixLen(old, oldStart(prev), oldEnd(prev), next, newStart(self), newEnd(self))
				: commonSuffixLen(old, oldStart(self), oldEnd(self), next, newStart(prev), newEnd(prev));
			if (suffix > 0) {
				if (ops[pointer + 1]?.tag === EQUAL) growLeft(ops[pointer + 1], suffix);
				else {
					const equalOld = (self.tag === INSERT ? oldEnd(prev) : oldEnd(self)) - suffix;
					const equalNew = (self.tag === INSERT ? newEnd(self) : newEnd(prev)) - suffix;
					ops.splice(pointer + 1, 0, { tag: EQUAL, oldIndex: equalOld, newIndex: equalNew, len: suffix });
				}
				shiftLeft(ops[pointer], suffix);
				shrinkLeft(ops[pointer - 1], suffix);
				if (isEmpty(ops[pointer - 1])) {
					ops.splice(pointer - 1, 1);
					pointer -= 1;
				}
			} else if (isEmpty(ops[pointer - 1])) {
				ops.splice(pointer - 1, 1);
				pointer -= 1;
			} else break;
		} else if ((self.tag === INSERT && prev.tag === DELETE) || (self.tag === DELETE && prev.tag === INSERT)) {
			swapAdjacent(ops, pointer - 1);
			pointer -= 1;
		} else if (self.tag === prev.tag && self.tag !== EQUAL) {
			growRight(ops[pointer - 1], self.len);
			ops.splice(pointer, 1);
			pointer -= 1;
		} else throw new Error(`unexpected ops in the diff's cleanup: ${prev.tag} then ${self.tag}`);
	}
	return pointer;
}

function shiftDown(ops: Move[], old: Seq, next: Seq, pointer: number): number {
	while (pointer + 1 < ops.length) {
		const following = copy(ops[pointer + 1]);
		const self = copy(ops[pointer]);
		if ((self.tag === INSERT || self.tag === DELETE) && following.tag === EQUAL) {
			if (self.tag === DELETE && ops[pointer + 2]?.tag !== DELETE) break;
			const prefix = self.tag === INSERT
				? commonPrefixLen(old, oldStart(following), oldEnd(following), next, newStart(self), newEnd(self))
				: commonPrefixLen(old, oldStart(self), oldEnd(self), next, newStart(following), newEnd(following));
			if (prefix > 0) {
				if (pointer >= 1 && ops[pointer - 1].tag === EQUAL) growRight(ops[pointer - 1], prefix);
				else {
					const equalOld = self.tag === INSERT ? oldStart(following) : oldStart(self);
					ops.splice(pointer, 0, { tag: EQUAL, oldIndex: equalOld, newIndex: newStart(self), len: prefix });
					pointer += 1;
				}
				shiftRight(ops[pointer], prefix);
				shrinkRight(ops[pointer + 1], prefix);
				if (isEmpty(ops[pointer + 1])) ops.splice(pointer + 1, 1);
			} else if (isEmpty(ops[pointer + 1])) ops.splice(pointer + 1, 1);
			else break;
		} else if ((self.tag === INSERT && following.tag === DELETE) || (self.tag === DELETE && following.tag === INSERT)) {
			swapAdjacent(ops, pointer);
			pointer += 1;
		} else if (self.tag === following.tag && self.tag !== EQUAL) {
			growRight(ops[pointer], following.len);
			ops.splice(pointer + 1, 1);
		} else throw new Error(`unexpected ops in the diff's cleanup: ${self.tag} then ${following.tag}`);
	}
	return pointer;
}

// ---- common runs -----------------------------------------------------------------------------

function commonPrefixLen(old: Seq, os: number, oe: number, next: Seq, ns: number, ne: number): number {
	if (os >= oe || ns >= ne) return 0;
	const max = Math.min(oe - os, ne - ns);
	let n = 0;
	while (n < max && next[ns + n] === old[os + n]) n++;
	return n;
}

function commonSuffixLen(old: Seq, os: number, oe: number, next: Seq, ns: number, ne: number): number {
	if (os >= oe || ns >= ne) return 0;
	const max = Math.min(oe - os, ne - ns);
	let n = 0;
	while (n < max && next[ne - 1 - n] === old[oe - 1 - n]) n++;
	return n;
}

// ---- the entry point and the pass before the search ------------------------------------------

interface Trimmed {
	oldStart: number;
	oldEnd: number;
	newStart: number;
	newEnd: number;
	originalOldStart: number;
	originalOldEnd: number;
	originalNewStart: number;
	originalNewEnd: number;
	prefixLen: number;
	suffixLen: number;
}

interface Reduced {
	oldValues: number[];
	oldIndices: number[];
	newValues: number[];
	newIndices: number[];
	trimmed: Trimmed;
}

const DISJOINT_FAST_PATH_MIN_LEN = 512;
const DISJOINT_FAST_PATH_MIN_WORK = 128 * 1024;
const DISJOINT_FAST_PATH_BOUNDARY_PROBE = 8;
const CONFUSING_RECORD_SCAN_WINDOW = 100;
const CONFUSING_RECORD_RATIO = 4;
const MAX_MATCH_FREQUENCY_THRESHOLD = 1024;
const NO_MATCH = -1;
const DISCARD = 0, KEEP = 1, INVESTIGATE = 2;

const isqrt = (n: number) => {
	let r = Math.floor(Math.sqrt(n));
	while (r * r > n) r--;
	while ((r + 1) * (r + 1) <= n) r++;
	return r;
};

function diff(d: Hook, old: Seq, os: number, oe: number, next: Seq, ns: number, ne: number): void {
	const pre = reduceForMyers(old, os, oe, next, ns, ne);
	if ("trimmed" in pre) diffReduced(d, pre);
	else diffPretrimmed(d, old, next, pre, HEURISTIC);
}

function trim(old: Seq, os: number, oe: number, next: Seq, ns: number, ne: number): Trimmed {
	const prefixLen = commonPrefixLen(old, os, oe, next, ns, ne);
	const suffixLen = commonSuffixLen(old, os + prefixLen, oe, next, ns + prefixLen, ne);
	return { oldStart: os + prefixLen, oldEnd: oe - suffixLen, newStart: ns + prefixLen, newEnd: ne - suffixLen, originalOldStart: os, originalOldEnd: oe, originalNewStart: ns, originalNewEnd: ne, prefixLen, suffixLen };
}

/** Whether two long ranges look unrelated enough at their ends to be worth indexing. */
function shouldScan(old: Seq, os: number, oe: number, next: Seq, ns: number, ne: number): boolean {
	const oldLen = oe - os, newLen = ne - ns;
	if (oldLen < DISJOINT_FAST_PATH_MIN_LEN || newLen < DISJOINT_FAST_PATH_MIN_LEN || oldLen * newLen < DISJOINT_FAST_PATH_MIN_WORK) return false;
	if (next[ns] === old[os] || next[ne - 1] === old[oe - 1]) return false;
	const probe = Math.min(oldLen, newLen, DISJOINT_FAST_PATH_BOUNDARY_PROBE + 1);
	for (let skip = 1; skip < probe; skip++) {
		if (next[ns + skip] === old[os] || next[ns] === old[os + skip] || next[ne - 1 - skip] === old[oe - 1] || next[ne - 1] === old[oe - 1 - skip]) return false;
	}
	return true;
}

function recordActions(ids: number[], oppositeCounts: number[]): Uint8Array {
	const limit = Math.min(Math.max(isqrt(ids.length), 1), MAX_MATCH_FREQUENCY_THRESHOLD);
	const out = new Uint8Array(ids.length);
	ids.forEach((id, i) => {
		const count = id === NO_MATCH ? 0 : oppositeCounts[id];
		out[i] = count === 0 ? DISCARD : count < limit ? KEEP : INVESTIGATE;
	});
	return out;
}

function scanConfusingRun(actions: Uint8Array, from: number, step: number): [number, number] {
	let discards = 0, investigates = 0;
	for (let i = from, seen = 0; i >= 0 && i < actions.length && seen < CONFUSING_RECORD_SCAN_WINDOW; i += step, seen++) {
		if (actions[i] === DISCARD) discards++;
		else if (actions[i] === INVESTIGATE) investigates++;
		else break;
	}
	return [discards, investigates];
}

function keepRecord(actions: Uint8Array, index: number): boolean {
	if (actions[index] === DISCARD) return false;
	if (actions[index] === KEEP) return true;
	// A popular line among lines with no match is confusing, and left out of the search.
	const [leftDiscards, leftInvestigates] = scanConfusingRun(actions, index - 1, -1);
	if (leftDiscards === 0) return true;
	const [rightDiscards, rightInvestigates] = scanConfusingRun(actions, index + 1, 1);
	if (rightDiscards === 0) return true;
	const discards = leftDiscards + rightDiscards;
	const investigates = leftInvestigates + rightInvestigates + 1;
	return !(investigates * CONFUSING_RECORD_RATIO < investigates + discards);
}

function reduceForMyers(old: Seq, os: number, oe: number, next: Seq, ns: number, ne: number): Trimmed | Reduced {
	const trimmed = trim(old, os, oe, next, ns, ne);
	const { oldStart: o0, oldEnd: o1, newStart: n0, newEnd: n1 } = trimmed;
	if (!shouldScan(old, o0, o1, next, n0, n1)) return trimmed;
	// Each distinct item an id, in the order the old side has them.
	const ids = new Map<number, number>();
	const oldValues: number[] = [];
	const newValues: number[] = [];
	const oldCounts: number[] = [];
	const newCounts: number[] = [];
	for (let i = o0; i < o1; i++) {
		let id = ids.get(old[i]);
		if (id === undefined) {
			id = oldCounts.length;
			ids.set(old[i], id);
			oldCounts.push(0);
			newCounts.push(0);
		}
		oldCounts[id]++;
		oldValues.push(id);
	}
	for (let i = n0; i < n1; i++) {
		const id = ids.get(next[i]) ?? NO_MATCH;
		if (id !== NO_MATCH) newCounts[id]++;
		newValues.push(id);
	}
	const reduced: Reduced = { oldValues: [], oldIndices: [], newValues: [], newIndices: [], trimmed };
	const oldActions = recordActions(oldValues, newCounts);
	oldValues.forEach((id, offset) => {
		if (keepRecord(oldActions, offset)) {
			reduced.oldValues.push(id);
			reduced.oldIndices.push(o0 + offset);
		}
	});
	const newActions = recordActions(newValues, oldCounts);
	newValues.forEach((id, offset) => {
		if (keepRecord(newActions, offset)) {
			reduced.newValues.push(id);
			reduced.newIndices.push(n0 + offset);
		}
	});
	if (reduced.oldIndices.length === o1 - o0 && reduced.newIndices.length === n1 - n0) return trimmed;
	return reduced;
}

/** Maps the script of the reduced items back: only their equal runs are anchors, and the gaps between are deleted and inserted whole. */
class ReducedHook implements Hook {
	d: Hook;
	reduced: Reduced;
	oldCursor: number;
	newCursor: number;
	constructor(d: Hook, reduced: Reduced) {
		this.d = d;
		this.reduced = reduced;
		this.oldCursor = reduced.trimmed.oldStart;
		this.newCursor = reduced.trimmed.newStart;
	}
	private gaps(oldAnchor: number, newAnchor: number) {
		if (this.oldCursor < oldAnchor) {
			this.d.delete(this.oldCursor, oldAnchor - this.oldCursor, this.newCursor);
			this.oldCursor = oldAnchor;
		}
		if (this.newCursor < newAnchor) {
			this.d.insert(this.oldCursor, this.newCursor, newAnchor - this.newCursor);
			this.newCursor = newAnchor;
		}
	}
	equal(oldIndex: number, newIndex: number, len: number) {
		const { oldIndices, newIndices } = this.reduced;
		let offset = 0;
		while (offset < len) {
			const oldAnchor = oldIndices[oldIndex + offset];
			const newAnchor = newIndices[newIndex + offset];
			this.gaps(oldAnchor, newAnchor);
			let run = 1;
			while (offset + run < len && oldIndices[oldIndex + offset + run] === oldAnchor + run && newIndices[newIndex + offset + run] === newAnchor + run) run++;
			this.d.equal(oldAnchor, newAnchor, run);
			this.oldCursor = oldAnchor + run;
			this.newCursor = newAnchor + run;
			offset += run;
		}
	}
	delete() {}
	insert() {}
	replace() {}
	finish() {
		this.gaps(this.reduced.trimmed.oldEnd, this.reduced.trimmed.newEnd);
	}
}

function diffReduced(d: Hook, reduced: Reduced): void {
	const t = reduced.trimmed;
	if (t.prefixLen > 0) d.equal(t.originalOldStart, t.originalNewStart, t.prefixLen);
	const hook = new ReducedHook(d, reduced);
	const { oldValues, newValues } = reduced;
	diffPretrimmed(hook, oldValues, newValues, trim(oldValues, 0, oldValues.length, newValues, 0, newValues.length), HEURISTIC);
	if (t.suffixLen > 0) d.equal(t.originalOldEnd - t.suffixLen, t.originalNewEnd - t.suffixLen, t.suffixLen);
	d.finish();
}

// ---- Myers -----------------------------------------------------------------------------------

const HEURISTIC = 0, RAW = 1;

function diffPretrimmed(d: Hook, old: Seq, next: Seq, t: Trimmed, mode: number): void {
	if (t.prefixLen > 0) d.equal(t.originalOldStart, t.originalNewStart, t.prefixLen);
	const oldEmpty = t.oldStart >= t.oldEnd, newEmpty = t.newStart >= t.newEnd;
	if (oldEmpty && newEmpty) {
		// Nothing to say.
	} else if (oldEmpty) d.insert(t.oldStart, t.newStart, t.newEnd - t.newStart);
	else if (newEmpty) d.delete(t.oldStart, t.oldEnd - t.oldStart, t.newStart);
	else {
		const maxD = maxDiagonals(t.oldEnd - t.oldStart, t.newEnd - t.newStart);
		conquer(d, old, t.oldStart, t.oldEnd, next, t.newStart, t.newEnd, new V(maxD), new V(maxD), mode);
	}
	if (t.suffixLen > 0) d.equal(t.originalOldEnd - t.suffixLen, t.originalNewEnd - t.suffixLen, t.suffixLen);
	d.finish();
}

/** The furthest-reaching x on each diagonal k, which can be negative. */
class V {
	offset: number;
	v: Int32Array;
	constructor(maxD: number) {
		this.offset = maxD;
		this.v = new Int32Array(2 * maxD);
	}
	get(k: number): number { return this.v[k + this.offset]; }
	set(k: number, x: number): void { this.v[k + this.offset] = x; }
}

const maxDiagonals = (n: number, m: number) => Math.ceil((n + m) / 2) + 1;

const SMALL_SIDE_EXACT_MAX = 64;
const SMALL_SIDE_EXACT_MIN_LARGE = 512;
const SMALL_SIDE_EXACT_MAX_WORK = 64_000_000;
const HEURISTIC_MIN_COST = 256;
const HEURISTIC_MIN_SNAKE = 20;
const HEURISTIC_MIN_MAX_COST = 256;
const HEURISTIC_PROGRESS_FACTOR = 4;

function conquer(d: Hook, old: Seq, os: number, oe: number, next: Seq, ns: number, ne: number, vf: V, vb: V, mode: number): void {
	const prefix = commonPrefixLen(old, os, oe, next, ns, ne);
	if (prefix > 0) d.equal(os, ns, prefix);
	os += prefix;
	ns += prefix;
	const suffix = commonSuffixLen(old, os, oe, next, ns, ne);
	const suffixOld = oe - suffix, suffixNew = ne - suffix;
	oe -= suffix;
	ne -= suffix;

	while (os < oe && ns < ne) {
		const [o, n] = frontAnchor(d, old, os, oe, next, ns, ne);
		if (o === os && n === ns) break;
		os = o;
		ns = n;
	}

	if (os >= oe && ns >= ne) {
		// Nothing left.
	} else if (ns >= ne) d.delete(os, oe - os, ns);
	else if (os >= oe) d.insert(os, ns, ne - ns);
	else if (smallSideExact(d, old, os, oe, next, ns, ne)) {
		// The exact search wrote the script.
	} else {
		const split = middleSnake(old, os, oe, next, ns, ne, vf, vb, mode);
		if (split) {
			conquer(d, old, os, split.oldIndex, next, ns, split.newIndex, vf, vb, split.leftMode);
			conquer(d, old, split.oldIndex, oe, next, split.newIndex, ne, vf, vb, split.rightMode);
		} else {
			d.delete(os, oe - os, ns);
			d.insert(os, ns, ne - ns);
		}
	}
	if (suffix > 0) d.equal(suffixOld, suffixNew, suffix);
}

/**
 * When one side is much longer than the other and both start alike after a few items, the
 * items before that are an insertion (or a deletion) by themselves. Returns where the ranges
 * start after what it said.
 */
function frontAnchor(d: Hook, old: Seq, os: number, oe: number, next: Seq, ns: number, ne: number): [number, number] {
	const MAX_SKIP = 4;
	const MIN_ANCHOR_COMMON = 96;
	const oldLen = oe - os, newLen = ne - ns;
	if (oldLen <= MIN_ANCHOR_COMMON || newLen <= MIN_ANCHOR_COMMON) return [os, ns];
	const small = Math.min(oldLen, newLen), large = Math.max(oldLen, newLen);
	if (large < small * 2) return [os, ns];
	const maxOldSkip = Math.min(oldLen - 1, MAX_SKIP);
	const maxNewSkip = Math.min(newLen - 1, MAX_SKIP);
	const preferInsert = newLen > oldLen;
	const preferDelete = oldLen > newLen;
	let best: [number, number, number] | undefined;
	search: for (let oldSkip = 0; oldSkip <= maxOldSkip; oldSkip++) {
		for (let newSkip = 0; newSkip <= maxNewSkip; newSkip++) {
			if (oldSkip === 0 && newSkip === 0) continue;
			if (oldSkip !== 0 && newSkip !== 0) continue;
			if (preferInsert && oldSkip !== 0) continue;
			if (preferDelete && newSkip !== 0) continue;
			if (next[ns + newSkip] !== old[os + oldSkip]) continue;
			const common = commonPrefixLen(old, os + oldSkip, oe, next, ns + newSkip, ne);
			if (common < MIN_ANCHOR_COMMON) continue;
			if (common >= MIN_ANCHOR_COMMON * 8) {
				best = [oldSkip, newSkip, common];
				break search;
			}
			// More in common first, then the shorter replacement, then the larger skips (as Rust orders the tuple).
			const better = best === undefined || compareTuples([common, -Math.max(oldSkip, newSkip), oldSkip, newSkip], [best[2], -Math.max(best[0], best[1]), best[0], best[1]]) > 0;
			if (better) best = [oldSkip, newSkip, common];
		}
	}
	if (!best) return [os, ns];
	const [oldSkip, newSkip, common] = best;
	if (oldSkip === 0) d.insert(os, ns, newSkip);
	else if (newSkip === 0) d.delete(os, oldSkip, ns);
	else d.replace(os, oldSkip, ns, newSkip);
	d.equal(os + oldSkip, ns + newSkip, common);
	return [os + oldSkip + common, ns + newSkip + common];
}

function compareTuples(a: number[], b: number[]): number {
	for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] - b[i];
	return 0;
}

/** When one side has at most 64 items and the other at least 512: the longest common subsequence, exactly. */
function smallSideExact(d: Hook, old: Seq, os: number, oe: number, next: Seq, ns: number, ne: number): boolean {
	const oldLen = oe - os, newLen = ne - ns;
	const small = Math.min(oldLen, newLen), large = Math.max(oldLen, newLen);
	if (small === 0 || small > SMALL_SIDE_EXACT_MAX || large < SMALL_SIDE_EXACT_MIN_LARGE || oldLen * newLen > SMALL_SIDE_EXACT_MAX_WORK) return false;
	if (oldLen <= newLen) smallOld(d, old, os, oldLen, next, ns, newLen);
	else smallNew(d, old, os, oldLen, next, ns, newLen);
	return true;
}

function smallOld(d: Hook, old: Seq, os: number, n: number, next: Seq, ns: number, m: number): void {
	const width = m + 1;
	// dp[i][j]: the common subsequence's length for old[i..] and new[j..].
	const dp = new Uint8Array((n + 1) * width);
	for (let i = n - 1; i >= 0; i--) {
		const row = i * width, below = (i + 1) * width;
		for (let j = m - 1; j >= 0; j--) dp[row + j] = next[ns + j] === old[os + i] ? dp[below + j + 1] + 1 : Math.max(dp[below + j], dp[row + j + 1]);
	}
	const takes = (i: number, j: number) => next[ns + j] === old[os + i] && dp[i * width + j] === dp[(i + 1) * width + j + 1] + 1;
	let i = 0, j = 0;
	while (i < n && j < m) {
		if (takes(i, j)) {
			const si = i, sj = j;
			while (i < n && j < m && takes(i, j)) { i++; j++; }
			d.equal(os + si, ns + sj, i - si);
		} else if (dp[(i + 1) * width + j] >= dp[i * width + j + 1]) {
			const si = i;
			const at = ns + j;
			while (i < n) {
				if (j >= m) { i = n; break; }
				if (takes(i, j)) break;
				if (dp[(i + 1) * width + j] >= dp[i * width + j + 1]) i++;
				else break;
			}
			d.delete(os + si, i - si, at);
		} else {
			const sj = j;
			const at = os + i;
			while (j < m) {
				if (i >= n) { j = m; break; }
				if (takes(i, j)) break;
				if (dp[(i + 1) * width + j] < dp[i * width + j + 1]) j++;
				else break;
			}
			d.insert(at, ns + sj, j - sj);
		}
	}
	if (i < n) d.delete(os + i, n - i, ns + j);
	if (j < m) d.insert(os + i, ns + j, m - j);
}

function smallNew(d: Hook, old: Seq, os: number, n: number, next: Seq, ns: number, m: number): void {
	const width = n + 1;
	// dp[i][j]: the common subsequence's length for new[i..] and old[j..].
	const dp = new Uint8Array((m + 1) * width);
	for (let i = m - 1; i >= 0; i--) {
		const row = i * width, below = (i + 1) * width;
		for (let j = n - 1; j >= 0; j--) dp[row + j] = next[ns + i] === old[os + j] ? dp[below + j + 1] + 1 : Math.max(dp[below + j], dp[row + j + 1]);
	}
	const takes = (i: number, j: number) => next[ns + i] === old[os + j] && dp[i * width + j] === dp[(i + 1) * width + j + 1] + 1;
	let i = 0, j = 0;
	while (i < m && j < n) {
		if (takes(i, j)) {
			const si = i, sj = j;
			while (i < m && j < n && takes(i, j)) { i++; j++; }
			d.equal(os + sj, ns + si, j - sj);
		} else if (dp[(i + 1) * width + j] >= dp[i * width + j + 1]) {
			const si = i;
			const at = os + j;
			while (i < m) {
				if (j >= n) { i = m; break; }
				if (takes(i, j)) break;
				if (dp[(i + 1) * width + j] >= dp[i * width + j + 1]) i++;
				else break;
			}
			d.insert(at, ns + si, i - si);
		} else {
			const sj = j;
			const at = ns + i;
			while (j < n) {
				if (i >= m) { j = n; break; }
				if (takes(i, j)) break;
				if (dp[(i + 1) * width + j] < dp[i * width + j + 1]) j++;
				else break;
			}
			d.delete(os + sj, j - sj, at);
		}
	}
	if (j < n) d.delete(os + j, n - j, ns + i);
	if (i < m) d.insert(os + j, ns + i, m - i);
}

interface Split {
	oldIndex: number;
	newIndex: number;
	leftMode: number;
	rightMode: number;
}

interface Candidate {
	oldIndex: number;
	newIndex: number;
	progress: number;
	forward: boolean;
}

const better = (best: Candidate | undefined, candidate: Candidate) => (best === undefined || candidate.progress > best.progress ? candidate : best);

const isInterior = (o: number, n: number, oldLen: number, newLen: number) => o <= oldLen && n <= newLen && (o !== 0 || n !== 0) && (o !== oldLen || n !== newLen);

function clampDiagonal(oldIndex: number, k: number, oldLen: number, newLen: number): [number, number] | undefined {
	if (k < 0 && -k > newLen) return undefined;
	const min = Math.max(k, 0);
	const max = k >= 0 ? Math.min(oldLen, newLen + k) : Math.min(oldLen, Math.max(0, newLen + k));
	if (min > max) return undefined;
	const o = Math.min(Math.max(oldIndex, min), max);
	return [o, o - k];
}

function middleSnake(old: Seq, os: number, oe: number, next: Seq, ns: number, ne: number, vf: V, vb: V, mode: number): Split | undefined {
	const n = oe - os, m = ne - ns;
	const delta = n - m;
	const odd = (delta & 1) === 1 || (delta & 1) === -1;
	vf.set(1, 0);
	vb.set(1, 0);
	const dMax = maxDiagonals(n, m);
	const maxCost = mode === HEURISTIC ? Math.max(isqrt(n + m), HEURISTIC_MIN_MAX_COST) : Infinity;
	const heuristic = (c: Candidate): Split => ({ oldIndex: os + c.oldIndex, newIndex: ns + c.newIndex, leftMode: c.forward ? RAW : HEURISTIC, rightMode: c.forward ? HEURISTIC : RAW });
	for (let d = 0; d < dMax; d++) {
		let good: Candidate | undefined, forward: Candidate | undefined, backward: Candidate | undefined;
		// The splits are only looked at once the search is expensive.
		const trackLimit = mode === HEURISTIC && d >= maxCost;
		const trackGood = mode === HEURISTIC && d > HEURISTIC_MIN_COST;

		// Forward.
		for (let k = d; k >= -d; k -= 2) {
			let x = k === -d || (k !== d && vf.get(k - 1) < vf.get(k + 1)) ? vf.get(k + 1) : vf.get(k - 1) + 1;
			const y = x - k;
			const x0 = x, y0 = y;
			if (x < n && y < m) x += commonPrefixLen(old, os + x, oe, next, ns + y, ne);
			const snake = x - x0;
			vf.set(k, x);
			if (odd && Math.abs(k - delta) <= d - 1 && vf.get(k) + vb.get(-(k - delta)) >= n) return { oldIndex: x0 + os, newIndex: y0 + ns, leftMode: RAW, rightMode: RAW };
			if (trackLimit) {
				const point = clampDiagonal(x, k, n, m);
				if (point && isInterior(point[0], point[1], n, m)) forward = better(forward, { oldIndex: point[0], newIndex: point[1], progress: point[0] + point[1], forward: true });
			}
			if (trackGood && snake >= HEURISTIC_MIN_SNAKE && x < n && y < m) {
				const progress = Math.max(0, x + y - Math.abs(k));
				if (progress > HEURISTIC_PROGRESS_FACTOR * d && isInterior(x0, y0, n, m)) good = better(good, { oldIndex: x0, newIndex: y0, progress, forward: true });
			}
		}

		// Backward.
		for (let k = d; k >= -d; k -= 2) {
			let x = k === -d || (k !== d && vb.get(k - 1) < vb.get(k + 1)) ? vb.get(k + 1) : vb.get(k - 1) + 1;
			let y = x - k;
			const x0 = x;
			if (x < n && y < m) {
				const advance = commonSuffixLen(old, os, os + n - x, next, ns, ns + m - y);
				x += advance;
				y += advance;
			}
			const snake = x - x0;
			vb.set(k, x);
			if (!odd && Math.abs(k - delta) <= d && vb.get(k) + vf.get(-(k - delta)) >= n) return { oldIndex: n - x + os, newIndex: m - y + ns, leftMode: RAW, rightMode: RAW };
			if (trackLimit) {
				const point = clampDiagonal(x, k, n, m);
				if (point) {
					const splitOld = n - point[0], splitNew = m - point[1];
					if (isInterior(splitOld, splitNew, n, m)) backward = better(backward, { oldIndex: splitOld, newIndex: splitNew, progress: point[0] + point[1], forward: false });
				}
			}
			if (trackGood && snake >= HEURISTIC_MIN_SNAKE && x <= n && y <= m) {
				const splitOld = n - x, splitNew = m - y;
				const progress = Math.max(0, x + y - Math.abs(k));
				if (splitOld > 0 && splitNew > 0 && progress > HEURISTIC_PROGRESS_FACTOR * d) good = better(good, { oldIndex: splitOld, newIndex: splitNew, progress, forward: false });
			}
		}

		if (good) return heuristic(good);
		if (d >= maxCost) {
			const split = forward && backward ? (forward.progress > backward.progress ? forward : backward) : forward ?? backward;
			if (!split) break;
			return heuristic(split);
		}
	}
	return undefined;
}
