# searchable-directory

A directory with a page for each record, filters and search, in EJS. It's what a directory of plugins, themes, companies or campgrounds looks like in ssqch: one data file, a page per record, a list that filters without a framework, and full-text search with no server.

What it shows:

- Structured data: `src/_data/campgrounds.json` has the twelve campgrounds, and `src/_data/amenities.json` names what each can have. Add a record and it has a page, a place in the list and a search entry on the next build.
- One page per record: `src/campground.ejs` paginates over the campgrounds with `size: 1`, so each gets its own page at `permalink: /campgrounds/<%= camp.slug %>/`, and `computed` gives it its title and description.
- Filters as a custom element: `<campground-filter>` (`src/elements/campground-filter.js`, loaded by `elementsPlugin()` on the one page that has it) filters the list by region and by what a campground has, from each item's `data-region` and `data-amenities`. The form is in the page, hidden, so its words are the template's; without JavaScript, the whole list is there. The choice goes in the address (`/?region=Lakeshore&has=water`), so a filtered list can be linked, and each campground's page links its region that way.
- Search with [Pagefind](https://pagefind.app): `SEARCH=1 ssqch build` runs `npx -y pagefind@1.6.0 --site dist` after the build, and the search button in the header opens Pagefind's search dialog (Ctrl+K or Cmd+K does too). `data-pagefind-body` on the campground pages' `<main>` means only they are indexed, not the home page that lists them all.

Build it with `ssqch build`, or `SEARCH=1 ssqch build` (needs Node for `npx`) and then `ssqch serve --built` to try the search.
