// `ssqch/rss`. Its plugin is ported with stage 5 of the move to Node (docs/node-migration.md); until
// then the module is here so a config that imports it loads, and the build says what's missing.
import { notYet } from "./not-yet.ts";

export function rssPlugin(options: Record<string, unknown> = {}) {
	return { name: "ssqch/rss", builtin: "ssqch/rss", options };
}

export const getNewestCollectionItemDate = (..._args: unknown[]): never => notYet("getNewestCollectionItemDate", "ssqch/rss");

export const dateToRfc3339 = (..._args: unknown[]): never => notYet("dateToRfc3339", "ssqch/rss");

export const dateToRfc822 = (..._args: unknown[]): never => notYet("dateToRfc822", "ssqch/rss");

export const absoluteUrl = (..._args: unknown[]): never => notYet("absoluteUrl", "ssqch/rss");

export const htmlToAbsoluteUrls = (..._args: unknown[]): never => notYet("htmlToAbsoluteUrls", "ssqch/rss");

export const feedHtml = (..._args: unknown[]): never => notYet("feedHtml", "ssqch/rss");
