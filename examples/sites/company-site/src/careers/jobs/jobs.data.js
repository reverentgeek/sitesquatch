// Every job opening's layout and tag, and its description (for search results and llms.txt) from
// its summary. The `jobs` schema in ssqch.config.js checks each one's front matter.
export default {
	layout: "job.jinja",
	tags: "jobs",
	computed: { description: data => data.summary }
};
