// The landing page's mileage boards. Every number is the README's ("Benchmarks"), and
// tests/numbers.test.ts checks that each `backedBy` is in it word for word, so when the README's
// measurements change, a test says so instead of the page falling behind.
export default {
	boards: [
		{
			figure: "0.92 s",
			says: "to rebuild a real blog, 161 pages with a feed and a sitemap, with its 4,985 image files already cached.",
			backedBy: ["**0.92 s**", "161 HTML pages", "4,985 files"],
		},
		{
			figure: "1.12 s",
			says: "for 10,000 synthetic pages, rendered on one thread.",
			backedBy: ["the 10,000 pages build in 1.12 s", "built on one thread"],
		},
		{
			figure: "2.85 s",
			says: "for 9,001 documentation pages, each with a 9,000-entry sidebar, and 1.4 million links checked.",
			backedBy: ["9,001 Markdown pages", "9,000-entry sidebar", "| Edge | 2.85 s |", "checks 1.4 million links"],
		},
	],
	conditions: "Measured on an Apple M5 Pro with ssqch 0.8.0 on Node 26. The same blog's first build, with every image still to encode, takes 25.6 s.",
	conditionsBackedBy: ["Apple M5 Pro", "ssqch 0.8.0 on Node 26", "**25.6 s**"],
};
