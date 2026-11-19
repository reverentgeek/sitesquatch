// The changelog's entries: one for each minor release, written for people (TODO.md, section 9,
// "The changelog, for people"). CHANGELOG.md stays the complete record, and each entry links to
// its section there. `release` is the version an entry starts with, `releases` every version it
// covers (tests/changelog.test.ts checks them against CHANGELOG.md), and an entry that covers
// several releases names the last with `lastRelease` and `lastDate`.
import { slug } from "../../lib/docs.ts";

const day = (date) => new Date(date).toISOString().slice(0, 10);

export default {
	layout: "entry.jinja",
	tags: "changelog",
	render: "md",
	computed: {
		permalink: (data) => `/changelog/${data.page.fileSlug}/`,
		// The anchor GitHub gives CHANGELOG.md's heading for the release: `## 0.9.0 - 2026-11-18`.
		notes: (data) => `https://github.com/reverentgeek/sitesquatch/blob/main/CHANGELOG.md#${slug(`${data.lastRelease ?? data.release} - ${day(data.lastDate ?? data.date)}`)}`,
		updated: (data) => day(data.lastDate ?? data.date),
	},
};
