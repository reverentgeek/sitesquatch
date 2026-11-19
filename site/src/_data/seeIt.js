// For each docs page, the examples whose features it explains (src/_data/examples.yml): the
// "See it working" box under the page. Keyed by the page's URL.
import { readData } from "ssqch";

export default function () {
	const byPage = {};
	for (const example of readData("src/_data/examples.yml")) {
		for (const feature of example.features) (byPage[feature.docs.split("#")[0]] ??= []).push({ name: example.name, label: feature.label });
	}
	return byPage;
}
