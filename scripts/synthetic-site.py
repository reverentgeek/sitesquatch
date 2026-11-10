#!/usr/bin/env python3
"""Write a synthetic documentation site for benchmarks: a few thousand
Markdown pages in sections, each with headings, links to its neighbours, a
fenced code block, tags and a sidebar from a data file.

    scripts/synthetic-site.py <folder> [pages] [engine]

`pages` defaults to 9000 (about the size of kubernetes.io's English docs),
and `engine` to edge (or njk, liquid). The same arguments always write the
same site.
"""
import json
import random
import sys
from pathlib import Path

WORDS = """trail pine cedar creek ridge moss fern lantern compass summit valley meadow thicket
footprint shadow quiet rustle ember canopy boulder hollow lichen timber marsh""".split()

LAYOUTS = {
    "edge": """<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>{{ title }} | {{ site.name }}</title><link rel="stylesheet" href="/highlight.css"></head>
<body>
<nav>
@each(section in navTree(nav, page.url))
<details{{{ section.open ? ' open' : '' }}}><summary>{{ section.title }}</summary>
@if(section.open)
<ul>
@each(item in section.pages)
<li><a href="{{ item.url }}"{{{ item.current ? ' aria-current="page"' : '' }}}>{{ item.title }}</a></li>
@end
</ul>
@end
</details>
@end
</nav>
<main>
<h1>{{ title }}</h1>
{{{ toc(page.headings) }}}
{{{ content }}}
<p>{{ readingTime(content) }} min read. Tagged {{ tags.join(', ') }}.</p>
</main>
</body>
</html>
""",
    "njk": """<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>{{ title }} | {{ site.name }}</title><link rel="stylesheet" href="/highlight.css"></head>
<body>
<nav>
{% for section in nav | navTree(page.url) %}
<details{% if section.open %} open{% endif %}><summary>{{ section.title }}</summary>
{% if section.open %}
<ul>
{% for item in section.pages %}
<li><a href="{{ item.url }}"{% if item.current %} aria-current="page"{% endif %}>{{ item.title }}</a></li>
{% endfor %}
</ul>
{% endif %}
</details>
{% endfor %}
</nav>
<main>
<h1>{{ title }}</h1>
{{ toc(page.headings) | safe }}
{{ content | safe }}
<p>{{ content | readingTime }} min read. Tagged {{ tags | join(', ') }}.</p>
</main>
</body>
</html>
""",
    "liquid": """<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>{{ title }} | {{ site.name }}</title><link rel="stylesheet" href="/highlight.css"></head>
<body>
<nav>
{% assign tree = nav | navTree: page.url %}
{% for section in tree %}
<details{% if section.open %} open{% endif %}><summary>{{ section.title }}</summary>
{% if section.open %}
<ul>
{% for item in section.pages %}
<li><a href="{{ item.url }}"{% if item.current %} aria-current="page"{% endif %}>{{ item.title }}</a></li>
{% endfor %}
</ul>
{% endif %}
</details>
{% endfor %}
</nav>
<main>
<h1>{{ title }}</h1>
{{ page.headings | toc }}
{{ content }}
<p>{{ content | readingTime }} min read. Tagged {{ tags | join: ', ' }}.</p>
</main>
</body>
</html>
""",
}


def sentence(rng, n):
    return " ".join(rng.choice(WORDS) for _ in range(n)).capitalize() + "."


def main():
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    root = Path(sys.argv[1])
    pages = int(sys.argv[2]) if len(sys.argv) > 2 else 9000
    engine = sys.argv[3] if len(sys.argv) > 3 else "edge"
    if engine not in LAYOUTS:
        sys.exit(f"engine must be one of {', '.join(LAYOUTS)}")
    rng = random.Random(42)
    per_section = 150
    sections = max(1, -(-pages // per_section))
    src = root / "src"
    (src / "_includes").mkdir(parents=True, exist_ok=True)
    (src / "_data").mkdir(parents=True, exist_ok=True)
    formats = '["md"]' if engine == "edge" else f'["{engine}", "md"]'
    (root / "ssqch.config.js").write_text(f"""import {{ defineConfig }} from "ssqch";
import {{ linksPlugin }} from "ssqch/links";
import {{ sitemapPlugin }} from "ssqch/sitemap";

export default defineConfig({{
  dirs: {{ input: "src", output: "dist" }},
  templateFormats: {formats},
  markdownEngine: "{engine}",
  markdown: {{ highlight: true }},
  schemas: {{ docs: {{ fields: {{ title: "string", order: "integer", tags: "string[]" }}, unknown: "error" }} }},
  plugins: [sitemapPlugin({{ url: "https://example.com" }}), linksPlugin()],
}});
""")
    (src / "_data" / "site.json").write_text(json.dumps({"name": "Synthetic Docs"}))
    (src / "_includes" / f"doc.{engine}").write_text(LAYOUTS[engine])
    nav = []
    made = 0
    for s in range(sections):
        name = f"section-{s:03d}"
        folder = src / "docs" / name
        folder.mkdir(parents=True, exist_ok=True)
        (folder / f"{name}.json").write_text(json.dumps({"layout": f"doc.{engine}", "tags": ["docs", name]}))
        entries = []
        count = min(per_section, pages - made)
        for p in range(count):
            slug = f"page-{p:03d}"
            title = sentence(rng, 3).rstrip(".")
            url = f"/docs/{name}/{slug}/"
            entries.append({"title": title, "url": url})
            nxt = f"/docs/{name}/page-{(p + 1) % count:03d}/"
            body = [f"---\ntitle: {title}\norder: {p}\n---\n", sentence(rng, 40), ""]
            for h in range(4):
                body += [f"## {sentence(rng, 4).rstrip('.')}", "", sentence(rng, 60), ""]
                if h == 1:
                    body += ["```js", f"export function step{p}(trail) {{", f"  return trail.map((t) => t.name + \"-{p}\");", "}", "```", ""]
                if h == 2:
                    body += [f"See [the next page]({nxt}) and [the section's first](/docs/{name}/page-000/#{'-'.join(['x'])}).".replace("#x", ""), ""]
                    body += ["- " + sentence(rng, 8), "- " + sentence(rng, 8), "- " + sentence(rng, 8), ""]
            (folder / f"{slug}.md").write_text("\n".join(body))
            made += 1
        nav.append({"title": f"Section {s}", "pages": entries})
    (src / "_data" / "nav.json").write_text(json.dumps(nav))
    (src / "index.md").write_text(f"---\ntitle: Home\nlayout: doc.{engine}\ntags: docs\norder: 0\n---\nStart with [the first page](/docs/section-000/page-000/).\n")
    print(f"Wrote {made + 1} pages in {sections} sections to {root} ({engine})")


main()
