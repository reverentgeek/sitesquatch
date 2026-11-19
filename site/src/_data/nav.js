// The docs' sidebar, in src/docs/nav.yml's order, with each page's sidebar name and its
// description (for the docs' map on /docs/): the shape navTree, navPager and navBreadcrumbs read.
import { pages } from "../../lib/docs.ts";

export default function () {
	const groups = [];
	for (const page of pages()) {
		let group = groups.find((g) => g.title === page.group);
		if (!group) groups.push((group = { title: page.group, pages: [] }));
		group.pages.push({ title: page.nav, url: page.url, description: page.description });
	}
	return groups;
}
