# blog-tags

A blog with two sections, in Nunjucks. Distilled from [blog.rust-lang.org](https://blog.rust-lang.org), which is built with Zola.

What it shows:

- Two sections (`blog/` and `inside/`), each with directory data that sets the layout and a dated permalink (`/blog/2024/01/15/hello-squatch/`). The permalink is Nunjucks, like the pages.
- A page per tag (`/tags/pine-cones/`) and an Atom feed per tag (`/tags/pine-cones/feed.xml`), from a `tagList` collection and pagination with `size: 1`.
- A feed for the whole site, a sitemap (`ssqch/sitemap`), and a redirect from an old URL (`aliases` and `ssqch/redirects`).
- Footnotes, heading anchors from a render hook (`_includes/hooks/heading.njk`), and build-time syntax highlighting (`markdown: { highlight: true }`).

Build it with `ssqch build`, or `ssqch serve` to browse it.
