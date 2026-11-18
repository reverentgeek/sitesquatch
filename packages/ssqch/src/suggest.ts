// "Did you mean": the closest of the names something could have meant.
//
// A name is close when a few edits (a letter added, dropped or changed) turn one into the other.
// Used for schema fields, config and plugin options, layouts, includes, links and the dev
// server's 404 page.

/** The candidate within two edits of `key`, for short names (a field, an option, a file). The first of the closest wins. */
export function closest(key: string, candidates: Iterable<string>): string | undefined {
	let best: string | undefined;
	let bestEdits = Infinity;
	for (const candidate of candidates) {
		const edits = editDistance(key, candidate);
		if (edits <= 2 && edits < candidate.length && edits < bestEdits) {
			best = candidate;
			bestEdits = edits;
		}
	}
	return best;
}

/**
 * The candidate closest to `wanted`, for URL paths: within three edits, and no more than a third
 * of the candidate (so `/a/` isn't close to `/b/`). A trailing slash on either doesn't count.
 */
export function closestPath(wanted: string, candidates: Iterable<string>): string | undefined {
	const trimmedWanted = wanted.replace(/\/+$/, "");
	const length = [...trimmedWanted].length;
	let best: string | undefined;
	let bestEdits = Infinity;
	for (const candidate of candidates) {
		const trimmed = candidate.replace(/\/+$/, "");
		const candidateLength = [...trimmed].length;
		// Too different in length to be within three edits: not worth comparing.
		if (Math.abs(candidateLength - length) > 3 || trimmed === trimmedWanted) continue;
		const edits = editDistance(trimmedWanted, trimmed);
		if (edits <= 3 && edits * 3 <= candidateLength && edits < bestEdits) {
			best = candidate;
			bestEdits = edits;
		}
	}
	return best;
}

/**
 * `closestPath` for many wanted paths against the same candidates (the link checker's "did you
 * mean" for each missing page, against every page of a big site): the candidates are read once,
 * and only those whose length is within three of the wanted path's are compared. The answers are
 * `closestPath`'s.
 */
export function closestPathFinder(candidates: Iterable<string>): (wanted: string) => string | undefined {
	const byLength = new Map<number, Array<{ order: number; candidate: string; trimmed: string; chars: number[] | undefined }>>();
	let order = 0;
	for (const candidate of candidates) {
		const trimmed = candidate.replace(/\/+$/, "");
		const length = codePoints(trimmed);
		let bucket = byLength.get(length);
		if (bucket === undefined) byLength.set(length, (bucket = []));
		bucket.push({ order: order++, candidate, trimmed, chars: undefined });
	}
	return (wanted) => {
		const trimmedWanted = wanted.replace(/\/+$/, "");
		const length = codePoints(trimmedWanted);
		const chars = lowerCodePoints(trimmedWanted);
		let best: string | undefined;
		let bestEdits = Infinity;
		let bestOrder = Infinity;
		for (let candidateLength = Math.max(0, length - 3); candidateLength <= length + 3; candidateLength++) {
			for (const c of byLength.get(candidateLength) ?? []) {
				if (c.trimmed === trimmedWanted) continue;
				c.chars ??= lowerCodePoints(c.trimmed);
				const edits = editsWithin(chars, c.chars, 3);
				// The first of the closest wins, as in `closestPath`.
				if (edits <= 3 && edits * 3 <= candidateLength && (edits < bestEdits || (edits === bestEdits && c.order < bestOrder))) {
					best = c.candidate;
					bestEdits = edits;
					bestOrder = c.order;
				}
			}
		}
		return best;
	};
}

/** The number of code points in `s` (what `[...s].length` counts). */
function codePoints(s: string): number {
	let n = s.length;
	for (let i = 0; i < s.length; i++) {
		const c = s.charCodeAt(i);
		if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length && (s.charCodeAt(i + 1) & 0xfc00) === 0xdc00) { n--; i++; }
	}
	return n;
}

const lowerCodePoints = (s: string): number[] => Array.from(s.toLowerCase(), (c) => c.codePointAt(0)!);

/** `editDistance` of two lowercased strings' code points when it's `limit` or less; otherwise some number over `limit`. */
function editsWithin(x: number[], y: number[], limit: number): number {
	if (Math.abs(x.length - y.length) > limit) return limit + 1;
	const row = new Int32Array(y.length + 1);
	for (let j = 0; j <= y.length; j++) row[j] = j;
	for (let i = 0; i < x.length; i++) {
		let previous = row[0];
		row[0] = i + 1;
		let least = row[0];
		for (let j = 0; j < y.length; j++) {
			const current = row[j + 1];
			row[j + 1] = x[i] === y[j] ? previous : 1 + Math.min(previous, current, row[j]);
			previous = current;
			if (row[j + 1] < least) least = row[j + 1];
		}
		// Every later row is at least this row's least.
		if (least > limit) return limit + 1;
	}
	return row[y.length];
}

/** The number of single-character edits between `a` and `b`, ignoring case. */
export function editDistance(a: string, b: string): number {
	const x = [...a.toLowerCase()], y = [...b.toLowerCase()];
	const row = Array.from({ length: y.length + 1 }, (_, i) => i);
	for (let i = 0; i < x.length; i++) {
		let previous = row[0];
		row[0] = i + 1;
		for (let j = 0; j < y.length; j++) {
			const current = row[j + 1];
			row[j + 1] = x[i] === y[j] ? previous : 1 + Math.min(previous, current, row[j]);
			previous = current;
		}
	}
	return row[y.length];
}
