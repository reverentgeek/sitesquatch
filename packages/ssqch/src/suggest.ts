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
