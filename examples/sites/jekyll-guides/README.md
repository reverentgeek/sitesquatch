# jekyll-guides

A small Jekyll site, distilled from [opensource.guide](https://opensource.guide) and [www.ruby-lang.org](https://www.ruby-lang.org) (both Jekyll), laid out as Jekyll lays one out (`_config.yml`, `_layouts`, `_includes`, `_posts`, a `_guides` collection, `_data`), built by ssqch with Jekyll's habits turned on. The layouts and pages are written for Jekyll and run as they are.

What it shows:

- `fromJekyll()` from `ssqch/from-jekyll`: Jekyll's `page` (`page.title`, `page.lang`, `page.categories`) and `site` (`site.posts` newest first, `site.guides`, `site.categories.news`, `site.data.trails`), with posts read in Jekyll's shape (`post.title`, `post.excerpt`).
- kramdown's Markdown: `markdown="1"` on an `<aside>` and a `<p>`, kramdown's heading ids and smart quotes (also `fromJekyll()`'s).
- Jekyll's tags: `{% highlight bash %}`, `{% link _guides/cedar.md %}` and `{% post_url 2026-03-01-pine-cone-season %}`.
- Jekyll's front matter: dates as Jekyll writes them (`2026-03-01 09:00:00 +0000`), categories as a word or a list, and `redirect_from`.
- Posts and the collection with their permalinks and layouts from directory data (`_posts/_posts.json`, `_guides/_guides.json`), and Liquid filters that write what Jekyll's do (`xml_escape`).

Build it with `ssqch build`. To move a Jekyll site of your own, `ssqch docs --from jekyll`.
