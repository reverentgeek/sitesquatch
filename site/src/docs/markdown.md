---
title: "Markdown"
description: "Markdown is CommonMark with GitHub's extensions."
---
Markdown is [CommonMark](https://commonmark.org) with GitHub's extensions: tables, strikethrough, footnotes, task lists, bare URLs as links, and alerts. Headings get `id`s, so every section can be linked to. The `markdown` config key turns the extensions on and off:

```js
export default defineConfig({
  markdown: {
    headingIds: "blackfriday", // or "github" (the default), or false
    smartPunctuation: true,
  },
});
```

| Option | Default | What it does |
| --- | --- | --- |
| `headingIds` | `"github"` | Automatic heading `id`s. `"github"` matches GitHub's anchors and github-slugger's (rehype-slug's, so Astro's and Docusaurus's) character for character (`Hello, World!` becomes `hello-world`; letters in any script, combining accents and emoji joiners stay); `"blackfriday"` matches Hugo's older ones (`A -- B` becomes `a-b`, not `a----b`); `"ascii"` transliterates first (`Straße 🦀` becomes `strasse-crab`, like Zola's). `"kramdown"` matches Jekyll's: kramdown's GFM ids for the page's headings (like GitHub's, but emoji and symbols are dropped: `😭 No reply` becomes `-no-reply`), and with `fromJekyll()`'s Markdown inside HTML, kramdown's own for headings inside it (ASCII letters and digits from the first letter on, `section` when none are left: `Café` becomes `caf`, `中文` becomes `section`). `"python-markdown"` matches MkDocs' (Python-Markdown's `toc` default: ASCII from the text, word characters and hyphens, lowercased, so `Café notes` becomes `cafe-notes`; and a repeated heading gets toc's `_1`, `_2`, with the page's links to it). `"markdown-it-anchor"` matches that plugin's default ids, which Eleventy sites with markdown-it-anchor have (the lowercase text with each run of spaces as `-`, then percent-encoded as `encodeURIComponent` does: `What’s new?` becomes `what%E2%80%99s-new%3F`); its `tabindex="-1"` and permalink markup are a heading hook's (`_includes/hooks/heading.*`, below). `"vitepress"` matches VitePress's (@mdit-vue's `slugify`: punctuation and spaces become one `-`, accents go, and a leading digit gets `_`, so `What's Vue?` becomes `what-s-vue` and `1. Setup` becomes `_1-setup`). A function of the heading's text makes your own: `headingIds: (text) => ...`. A repeated heading gets `-1`, `-2` and so on. `false` turns them off. Why the styles: a heading's id is part of a URL (`/guide/#install`), and other sites link to it, so a site moving to ssqch keeps the ids it had, whichever generator wrote them, and no one's link breaks. |
| `headingAttributes` | `true` | `## Install {#setup .wide}` sets the heading's `id` and `class`. An `id` given this way always wins. Markdown that runs through Jinja or Nunjucks first (the default) keeps it: `{#` at the end of a line, closed by `}` rather than `#}`, isn't a comment there. |
| `footnotes` | `true` | `[^1]` references, with the notes in a `<section class="footnotes">` at the end and links back to each reference. |
| `taskLists` | `true` | `- [ ]` and `- [x]` items, as disabled checkboxes. |
| `autolinks` | `true` | Bare `https://` and `www.` URLs become links. `"fuzzy"` links bare domains and email addresses too (`example.com`, `ranger@example.com`), as markdown-it's `linkify` does ([below](#markdown-its-habits)). `"email"` links URLs and email addresses (`mailto:`) but not bare domains, as `linkify` with `fuzzyLink: false` does, which is VitePress's setting. |
| `alerts` | `true` | GitHub's `> [!NOTE]`, `[!TIP]`, `[!IMPORTANT]`, `[!WARNING]` and `[!CAUTION]`, as `<div class="markdown-alert markdown-alert-note">` with a title, the same markup GitHub uses (or a container template of that name, below). |
| `containers` | `true` | `::: name args` blocks (below). A closing `:::` indented less than four spaces closes the innermost open container wherever it is, so Prettier's `:::`, indented under the list it ends (`- two\n  :::`), closes it, as markdown-it-container (and VitePress) read them. |
| `definitionLists` | `false` | A term, then `: definition` lines, as `<dl>`. |
| `smartPunctuation` | `false` | Curly quotes, `--` and `---` as dashes, `...` as an ellipsis. A `--` that follows a space and runs into a word stays as it is, so `run it with --fix` keeps its flag. |
| `breaks` | `false` | A single newline inside a paragraph or a list item becomes a `<br>`. (markdown-it's `breaks: true`, [below](#markdown-its-habits).) |
| `figures` | `false` | An image, or a linked image, alone in a paragraph becomes a `<figure>` with its alt text as the `<figcaption>`. (markdown-it-implicit-figures, [below](#markdown-its-habits).) |
| `sourceLinks` | `false` | Links to `.md` files go to the page built from that file, as GitHub, MkDocs and jekyll-relative-links read them: `[Setup](setup/install.md#first-steps)` links to that page's URL with its `#` part. `true` writes the URL from the site's root (`/setup/install/#first-steps`); `"relative"` writes it from the page, as MkDocs does (`setup/install/#first-steps`, `../../` back to the home page). A link to a `.md` file that isn't a page is left as it is, so the link checker reports it. It applies to pages' Markdown, not the `markdown` filter. |
| `indentedCode` | `true` | Lines indented four spaces are code. `false` makes them ordinary Markdown, for HTML indented inside Markdown; fences are still code. |
| `highlight` | `false` | Syntax highlighting at build time (below). `true`, or `{ css: "/assets/code.css" }` to put the stylesheet somewhere else, or `{ css: false }` to leave it out. `languages` adds languages or replaces built-in ones: `{ languages: { chordpro: code => tokens, cho: "chordpro", snack: "grammars/snack.sublime-syntax" } }` (below). `classes` names the tokens as another highlighter does: `{ classes: "prism" }` ([below](#another-highlighters-classes)). |
| `math` | `false` | TeX math, kept as written for KaTeX or MathJax: `$...$` inline and `$$...$$` for display, where a `$` in prose (`$5 and $10`) stays a dollar. `{ render: "katex" }` renders each formula at build time with the site's own `katex` package, and `katex` passes KaTeX's options: `{ render: "katex", katex: { macros: { "\\RR": "\\mathbb{R}" } } }` ([below](#math-with-katex-or-mathjax)). |
| `preprocess` | none | A function of yours that changes a page's Markdown before ssqch reads it: `preprocess: (source, data) => source.replace(/<script setup>[\s\S]*?<\/script>\n?/g, "")` leaves out Vue's `<script setup>` blocks. It gets the page's Markdown (after front matter, and after the template language when `markdownEngine` runs one) and the page's data (`data.page.inputPath`), and returns the Markdown (or a promise of it). It runs for pages, not for the `markdown` filter; an error in it names the page. For a step that's a language of its own, an engine in `markdownEngine` works too. |

Another generator's Markdown, for a site moving from it, is a plugin of its own, each documented in its trailhead: `fromJekyll()` (kramdown's Markdown inside HTML, its heading ids), `fromMkdocs()` (Python-Markdown, admonitions and tabs), `fromHugo()` (shortcodes as containers) and `fromVitepress()` (VitePress's containers, headings, links and code blocks).

**Syntax highlighting:** with `highlight: true`, fenced code is highlighted while the site builds, so pages need no highlighting script. The grammars are Sublime Text's and TextMate's (about 200 languages, from [syntect](https://github.com/trishume/syntect) and [bat](https://github.com/sharkdp/bat)), plus ssqch's own for the template languages those don't cover (`edge`, `liquid`, `hbs`, `mustache` and `ejs`: the tags, over highlighted HTML) and for ChordPro songs (`chordpro` and `cho`: directives, `[G7]` chords and comments), and each token gets one class for what it is: `hl-keyword`, `hl-string`, `hl-comment`, `hl-function`, `hl-type`, `hl-number` and so on. The build writes a stylesheet for them to `/highlight.css` (link it from your layout) with GitHub's colors, light and dark. Each color is a CSS custom property, like `--hl-keyword`, so a theme switch or your own palette only has to set those. Mark lines with braces in the fence's info string, ```` ```js {1,4-6} ````, and those lines get `class="line highlighted"`. A language without a grammar renders as plain `<pre><code class="language-x">`.

**Template code in a code block:** a Markdown page runs through its `markdownEngine` (Jinja, unless you change it) before it's Markdown, so `{{ }}` and `{% %}` in a page are template code, in a fenced code block too. To show them as written (GitHub Actions' `${{ secrets.TOKEN }}`, Vue's `{{ message }}`), put the block between `{% raw %}` and `{% endraw %}` (Jinja, Nunjucks and Liquid), write `@{{` for each `{{` in Edge, `\{{` in Handlebars or `<%%` for each `<%` in EJS, or set `markdownEngine: false` for no template engine in Markdown at all. A template error on a line inside a code block says this too.

**Your own languages:** `languages`, in `highlight: { languages: { ... } }`, gives a highlighter for a language ssqch doesn't have (a custom syntax highlighter), or replaces a built-in one. Each name is a fence's language, matched in any case, and it comes before the built-in grammars. A highlighter can be a function, `(code, lang) => tokens`, that returns the code cut into tokens, as `[text, kind]` pairs or `{ text, kind }` objects, where `kind` is one of the `hl-*` names without the prefix (`comment`, `keyword`, `operator`, `string`, `regexp`, `escape`, `number`, `constant`, `builtin`, `property`, `attribute`, `function`, `type`, `parameter`, `tag`, `heading`, `strong`, `emphasis`, `link`, `inserted` or `deleted`) and a token without one (or a plain string) is plain text. ssqch escapes the text and writes the spans, so marked lines and `/highlight.css` work as they do for the built-in languages. The tokens' text has to add up to the code; when it doesn't, or the function throws or returns another kind, the build warns (naming the page) and that fence is plain text. A highlighter can also be another language's name, an alias (`cho: "chordpro"`, `jsx: "js"`), or the path of a Sublime Text `.sublime-syntax` grammar from the project root, for a language that has one. A replacement only takes the name it's given: `js: fn` leaves `javascript` fences to the built-in grammar, unless you add `javascript: "js"`. The languages apply everywhere highlighting does: fences, `highlight(code, lang)` and a fence hook's `highlighted`.

```js
// Trail notes: a line that starts with `!` is a warning, and `@Cedar` names a trail.
const trailnotes = code => code.split( /(^!.*$|@\w+)/m ).filter( Boolean ).map( text => text.startsWith( "!" ) ? [ text, "deleted" ] : text.startsWith( "@" ) ? [ text, "type" ] : [ text ] );
export default { markdown: { highlight: { languages: { trailnotes, trail: "trailnotes" } } } };
```

**A table of contents:** after a page's content renders, `page.headings` lists its headings (`level`, `id` and `text`), so its layouts can build a table of contents. The built-in `toc` filter does it for you: `{{{ toc(page.headings) }}}` writes nested `<ul>` links to the `h2` and `h3` headings, and `toc(page.headings, { from: 2, to: 4, ordered: true })` changes the levels or uses `<ol>`. `id` and `class` go on the outer list, `sublistClass` on the lists inside it, `itemClass` on each `<li>` (with `{level}` replaced by the heading's level) and `linkClass` on each link, so jekyll-toc's markup is `toc(page.headings, { class: "section-nav", itemClass: "toc-entry toc-h{level}" })`, and an unknown option is an error that lists them. In Liquid that's `{{ page.headings | toc: 2, 4 }}`, or `{{ page.headings | toc: class: "section-nav" }}` with options, and in Nunjucks, `{{ toc(page.headings) | safe }}`. The headings come from the HTML, so they work for pages in any template language. Collections have them too (`post.page.headings`). They're there once the page has rendered: in its layouts, and in a collection item after that item's `templateContent` has been read. Read in `computed`, which runs before any page renders, they're an empty list. `page.headings` are the page's own; for headings a layout adds around them, give `toc` the HTML instead, `toc(content)` in an outer layout (the same options), as eleventy-plugin-nesting-toc took it.

For example, a docs layout with the page's own contents beside it, and a base layout around it that lists every `h2`, the one its child layout adds included. `_includes/doc.jinja` lists the page's headings, `h2` and `h3`:

```jinja
---
layout: base.jinja
---
<aside class="toc">{{ toc(page.headings) | safe }}</aside>
<main>{{ content }}<h2 id="trail-report">Trail report</h2></main>
```

`_includes/base.jinja` lists what the layouts inside it wrote, `h2` only:

```jinja
<body><aside class="all">{{ toc(content, { to: 2 }) | safe }}</aside>{{ content }}</body>
```

A page with `## Food`, `## Water` and `### Filters` gets Food, Water and Filters in the first list, and Food, Water and Trail report in the second. In Jinja and Nunjucks, `toc` needs `| safe`, or its links print as text.

**Highlighting anywhere:** `highlight(code, lang)` returns the highlighted HTML for the inside of a `<code>` (escaped text for a language without a grammar), for code that isn't a Markdown fence: an example container's source, a snippet from a data file.

**The highlighting cache:** each build keeps the code it highlighted in `.cache/ssqch/highlight/fences.json`, beside `fetch`'s copies and the images, and the next build takes the HTML from there instead of loading the grammars, which is most of what highlighting costs a new process: the ReverentGeek blog's `ssqch build` takes 0.64 s with it and 1.0 s without (rendering, 48 ms against 390 ms). `ssqch serve` keeps the same fences in memory between rebuilds, so the file is for its first build and for `ssqch build`. A fence is kept by its language, code and marked lines, the site's `languages` (a `.sublime-syntax` file by its contents), and the highlighter's own version: a hash of what ssqch's highlighter is built from, so a release that changes highlighting starts afresh by itself. Fences a site's own function highlights aren't kept, because a function can answer differently each time, and `highlight(code, lang)` in a template uses the cache too. The file holds the fences the last build used and no others, it's written only when they change (beside its place, then moved in), and a build that fails doesn't write it. A file that's damaged or from another version of ssqch is ignored and written again, never an error, and the cache never changes a page: a build with it writes the same bytes as a build without. `leaveNoTrace` cleans the output, not `.cache`; delete the file (or `.cache/`) to highlight everything again, and restore `.cache/ssqch` in CI to keep it, as for images.

**Markdown anywhere:** the `markdown` filter renders a string, such as a description from front matter: `{{{ markdown(summary) }}}`, or `markdown(title, "inline")` (in Liquid, `{{ title | markdown: "inline" }}`) to leave out the `<p>`. Config and data files can `import { markdown } from "ssqch"`, which takes the same `"inline"` (or `{ inline: true }`); another option is an error naming the two.

**Containers:** a block between `::: name` and `:::` renders through `_includes/containers/name.*`, a template in any engine. It gets the page's data plus `container.name`, `container.args` (the rest of the opening line, without `[` `]` around it: `:::tip[Watch out]` works), `container.props` (the arguments read as a component's attributes: `::: card type="tip" open items='["a","b"]'` is `{ type: "tip", open: true, items: ["a", "b"] }`, where a single-quoted value that starts with `{` or `[` is JSON, an unquoted one like `size=3` is the text `3`, and a word on its own is `true`), `container.slots` (below), `container.content` (the block's Markdown, rendered) and `container.source` (the block's lines as written, for an example that shows its own code), and `container.inline`, true for a Hugo shortcode inside a line of text (with `fromHugo()`, [Moving from Hugo](trailheads/from-hugo.md)), whose output goes in the line). One template covers admonitions, tabs, figures or anything else that wraps content:

```markdown
::: warning Hot pine cones
They're **very** crunchy.
:::
```

```njk
{# src/_includes/containers/warning.njk #}
<aside class="callout warning">
  <p class="callout-title">{{ container.args or "Warning" }}</p>
  {{ container.content | safe }}
</aside>
```

Containers nest: an outer one opens with more colons (`::::`) and closes with as many. Without a template, a container renders as `<div class="name">` (with the arguments as a `<p class="container-title">`). An alert renders through a container template with its name, if there is one, so `containers/warning.njk` styles `> [!WARNING]` too.

**Named slots:** a `::: slot <name>` block (or `::: slot name="<name>"`) inside another container is that container's `container.slots.<name>`, its Markdown rendered, and is left out of `container.content`, as MDX's `<Fragment slot="title">` and a component's named slots are. Two slots with the same name are joined. A slot with no container template around it to take it (the container renders as a `<div>`, or the slot is on its own) stays where it is, as its content. `slot` is ssqch's: `_includes/containers/slot.*` is an error.

```markdown
:::: card type="tip"
Squatch Snacks, **crunchy**.

::: slot title
Pine Cone Crunch
:::
::::
```

```njk
{# src/_includes/containers/card.njk #}
<div class="card {{ container.props.type }}">
  <h3>{{ container.slots.title | safe }}</h3>
  {{ container.content | safe }}
</div>
```

**Render hooks:** templates in `_includes/hooks/` take over how parts of Markdown render, in any engine. Each gets the page's data plus one value:

| Template | Gets | For example |
| --- | --- | --- |
| `heading.*` | `heading.level`, `id`, `text`, `content` (the inner HTML) and `attrs` | Anchor links next to headings |
| `table.*` | `table.content` (the table's rows as ssqch writes them, `<thead>` to `</tbody>`, alignment included) and `columns` (how many); the template writes the `<table>` | VitePress's `<table tabindex="0">{{ table.content \| safe }}</table>`, or a wrapper that scrolls |
| `link.*` | `link.href` (the URL as the page wrote it, not percent-encoded as ssqch writes a link without a hook; browsers go to the same place either way), `title`, `text` and `content` | `target="_blank"` and an icon on external links |
| `image.*` | `image.src`, `alt` and `title` | `<figure>` with a caption |
| `footnote-ref.*` | `footnote.number`, `label`, `id` (the note's), `refId` (this reference's) and `index` (1 for a note's first reference) | Footnote links in another generator's markup |
| `footnotes.*` | `footnotes`: a list of `number`, `label`, `id`, `content` (the note's HTML) and `refs` (the ids of its references) | The notes as a `<div>` each, or as sidenotes |
| `code.*` | `code.code` (the code span's text, which the template escapes) | Rouge's `highlighter-rouge` classes on code spans, as GitHub Pages writes them |
| `fence.*`, or `fence-<lang>.*` for one language | `fence.lang`, `info` (the whole line after the backticks, like `js {1,3} title="app.js"`), `code`, and `highlighted` (the highlighted HTML, with `highlight` on) | Diagrams from `mermaid` fences, titled code blocks |

```jinja
{# src/_includes/hooks/heading.jinja #}
<h{{ heading.level }} id="{{ heading.id }}">{{ heading.content | safe }} <a href="#{{ heading.id }}" class="anchor" aria-hidden="true">#</a></h{{ heading.level }}>
```

Put `aria-hidden="true"` on decoration like that `#`, and `page.headings` leaves it out of the heading's text.

A fence hook writes the whole block, so it has to write `<pre><code>` itself: `fence.highlighted` is only what goes inside it (spans, already escaped), and `fence.code` is the raw text, which the template escapes (Nunjucks and Jinja do it by themselves; in Liquid write `{{ fence.code | escape }}`). With `highlight` off, `highlighted` is empty:

```njk
{# src/_includes/hooks/fence.njk #}
<div class="code-block">
  <button class="copy" data-code="{{ fence.code }}">Copy</button>
  <pre><code class="language-{{ fence.lang }}">
    {%- if fence.highlighted %}{{ fence.highlighted | safe }}{% else %}{{ fence.code }}{% endif -%}
  </code></pre>
</div>
```

**Code spans:** a `code.*` hook writes each inline code span (`` `ssqch build` ``) from its text, `code.code`, which the template escapes as a fence hook's does (Jinja and Nunjucks do it by themselves; in Liquid, `{{ code.code | escape }}`). A site moving from GitHub Pages keeps its CSS for Rouge's markup with `<code class="language-plaintext highlighter-rouge">{{ code.code }}</code>`. Fences don't go through it; they have `fence.*`.

## Math with KaTeX or MathJax

> [!NOTE]
> **Not released yet.** This ships with the next version of ssqch.

With `math: true`, TeX between dollar signs is math, kept as written: `$...$` inline and `$$...$$` for display. Without it, Markdown reads TeX as its own, before KaTeX or MathJax can see it, and with no warning: `$a*b*c$` gets an `<em>`, `$\{x\}$` loses its backslashes and `\\` in `\begin{cases}` becomes `\`. With it, the formula reaches the page as you wrote it:

```js
export default { markdown: { math: true } };
```

```markdown
The trail climbs $h = 2^n$ meters, where $n$ is the number of pine cones.

$$
f(x) = \begin{cases} x^2 & \text{if } x > 0 \\ 0 & \text{otherwise} \end{cases}
$$
```

**What a formula becomes:** inline math is `<span class="math math-inline">\(h = 2^n\)</span>`, and display math on lines of its own is `<div class="math math-display">\[...\]</div>` (`$$...$$` inside a line is a `<span class="math math-display">`, since a paragraph can't hold a `<div>`). The TeX is as written, only escaped for HTML (`<` is `&lt;`, which the browser reads back as `<`). `\(...\)` and `\[...\]` are the delimiters KaTeX's auto-render and MathJax look for by default, so either renders the page's formulas with no settings of its own, and the `math` class with `math-inline` or `math-display` (pulldown-cmark's names, which older remark-math setups write too) gives CSS something to hold on to. KaTeX's auto-render, in the layout (with the version you want):

```html
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.22/dist/katex.min.css">
<script defer src="https://cdn.jsdelivr.net/npm/katex@0.16.22/dist/katex.min.js"></script>
<script defer src="https://cdn.jsdelivr.net/npm/katex@0.16.22/dist/contrib/auto-render.min.js" onload="renderMathInElement(document.body)"></script>
```

Or MathJax: `<script defer src="https://cdn.jsdelivr.net/npm/mathjax@3.2.2/es5/tex-chtml.js"></script>`. To render at build time instead, with no script in the page, see `render: "katex"` below.

**When a dollar is a dollar:** the rules are GitHub's (pulldown-cmark's), with pandoc's and markdown-it-katex's rule about digits, so prices stay prices. An opening `$` can't be followed by a space, and a closing `$` can't come after a space or be followed by a digit: `$5 and $10` and `$20-$30` are text. `\$` is a dollar sign, in text and in TeX (`$\$5$`), and a `$` on its own is text. Code spans and fenced code aren't read for math, and whichever opens first wins: `` `$x$` `` is code. Braces in inline math have to balance (`$}{$` is text), and a blank line ends a formula, as it ends a paragraph. In a table, a `|` in a formula ends its cell, as on GitHub: write `\vert` (or `\lvert ... \rvert`) for the bar. A fence with the language `math` stays a code block (a fence hook, `_includes/hooks/fence-math.*`, can make it a formula).

**Template code in math:** a Markdown page runs through its `markdownEngine` (Jinja, unless you change it) before it's Markdown, and TeX's braces can be template code there: `{{` starts an expression, `{%` a tag and `{#` a comment. `\frac{{a}}{b}` would lose `{a}` (an undefined `a` prints as nothing, so the page has `\frac{b}`), and `x^{{2}}` would become `x^2`: the build warns about each page with a formula like that, at the first one's line (a `template` warning), so nothing is lost quietly. `{%` is an error on the formula's line (`unknown statement`), `{%` is an error on the formula's line (`unknown statement`), and an unclosed `{#` is an error that names the page (`expected end of comment, got end of file`). TeX ignores spaces in math, so a space between the braces keeps a formula as written in every engine: `\frac{ {a} }{b}`, `\{ \#1 \}`. Or put the formula, or the page, between `{% raw %}` and `{% endraw %}` (Jinja, Nunjucks and Liquid), or set `markdownEngine: false` when the site's Markdown has no template code.

**Where math is read:** in pages' Markdown, the `markdown` filter (`{{ summary | markdown }}`) and `markdown()` from `ssqch` while the site builds (`markdown()` called as the config loads, before the site's options are read, has math off). A heading's `id` uses the TeX as written (`## The $\alpha$ case` is `#the-alpha-case`), and its `page.headings` text, for `toc`, is the formula's markup as written (`\(\alpha\)`, which the page's script renders in the table of contents too) or, rendered at build time, its characters (`α`). A Markdown page's copy for `llmsPlugin()` is its Markdown, TeX and all, and a copy made from a page's HTML writes each formula back as `$...$` or `$$...$$`. A feed's content (`feedPlugin()`, and `feedHtml` in a feed template) is the page's HTML; formulas rendered at build time go in it as KaTeX's MathML alone, which feed readers show without a stylesheet. Hooks see a formula's markup inside `heading.content` and a container's `container.content`.

**KaTeX at build time:** `math: { render: "katex" }` renders each formula while the site builds, with the site's own KaTeX (ssqch doesn't come with it, so the version is yours): install it with `npm install -D katex`. Pages need no script, but they still need KaTeX's stylesheet and its fonts: link `katex/dist/katex.min.css`, from a CDN at the version you installed, or copied with `passthrough: { "node_modules/katex/dist/**": "katex" }` and linked as `/katex/katex.min.css`.

```js
export default {
  markdown: {
    math: { render: "katex", katex: { macros: { "\\RR": "\\mathbb{R}" } } },
  },
};
```

`katex` is KaTeX's own options for its `renderToString` (`macros`, `strict`, `trust`, `output`, `fleqn`...), the same for every formula: ssqch sets `displayMode` for each, and `throwOnError: true` unless you set it. The formula's element stays (`<span class="math math-inline">` with KaTeX's HTML inside). A formula KaTeX can't render is an error with its page and line: `src/posts/trail.md:12: KaTeX can't render $\fraq{a}{b}$: Undefined control sequence: \fraq (at character 1)`. With katex not installed, the first page with math says what to run: ``markdown.math: render: "katex" needs the katex package in the site's packages: `npm install -D katex` `` (or `pnpm add -D katex`, by the site's lockfile). A mistyped option is an error that names it (`markdown.math.render must be "katex" ...`); MathJax has no build-time rendering here, so `render: "mathjax"` is one too: use its script in the page.

## Your own highlighter, step by step

A ranger's trail log, highlighted: dates, trails, counts and comments. The highlighter is a file of its own, so it can be tested on its own, and the config imports it.

`highlighters/trail-log.js` cuts the code into tokens with one regular expression, and keeps everything between the matches as plain text, so the tokens' text adds up to the code:

```js
// A ranger's trail log: `2026-06-01` dates, `@Cedar` trails, `#` comments, and counts.
const TOKEN = /(#.*$)|(\d{4}-\d{2}-\d{2})|(@[A-Za-z-]+)|(\b\d+\b)/gm;

export default function trailLog( code ) {
	const tokens = [];
	let last = 0;
	for ( const m of code.matchAll( TOKEN ) ) {
		if ( m.index > last ) tokens.push( code.slice( last, m.index ) );
		const kind = m[ 1 ] ? "comment" : m[ 2 ] ? "constant" : m[ 3 ] ? "type" : "number";
		tokens.push( [ m[ 0 ], kind ] );
		last = m.index + m[ 0 ].length;
	}
	if ( last < code.length ) tokens.push( code.slice( last ) );
	return tokens;
}
```

`ssqch.config.js` names it, and `log` as another name for the same language:

```js
import trailLog from "./highlighters/trail-log.js";

export default {
  markdown: { highlight: { languages: { "trail-log": trailLog, log: "trail-log" } } },
};
```

A fence with `{2}` marks its second line, as it does for a built-in language:

````md
```trail-log {2}
2026-06-01 @Cedar 3 pine cones # all on the bench
2026-06-02 @Old-Growth 1 footprint # probably a bear
```
````

Each line is a `<span class="line">` (the marked one `line highlighted`), and each token a span with its kind: `<span class="hl-constant">2026-06-01</span> <span class="hl-type">@Cedar</span> <span class="hl-number">3</span> pine cones <span class="hl-comment"># all on the bench</span>`. `/highlight.css` colors them as it colors JavaScript's.

- **What the function gets:** the fence's code without its last newline, and the fence's language as it's written (`log` for the alias) as the second argument. It runs for each fence on every build: a site's own function isn't kept in the highlighting cache.
- **When it's wrong:** the fence is plain text and the build warns, naming the page, so a mistake never prints broken markup. Tokens that don't add up to the code: `` warn: src/log.md: a `trail-log` fence is plain text: markdown.highlight.languages.trail-log returned tokens whose text isn't the code (they differ from line 1) ``. A kind that isn't one: `returned the kind "sparkle", which isn't one of comment, keyword, ...`, with the whole list. A function that throws: `markdown.highlight.languages.trail-log failed: lost the trail`.
- **When not to write one:** a language with a Sublime Text grammar (most have one) is a `.sublime-syntax` path instead, `{ snack: "grammars/snack.sublime-syntax" }`, which highlights it fully and is kept in the cache. A language ssqch has under another name is an alias: `{ jsx: "js" }`. A function is for a small language of your own, where a grammar would be more than it needs.

## Another highlighter's classes

**Another highlighter's classes:** a site that styles its code with a Prism theme, or another highlighter's CSS, can keep it: `classes`, in `highlight: { classes }`, names the tokens as that highlighter does. `classes: "prism"` gives every token Prism's names (`token keyword`, `token string`, `token class-name` for a type, `token regex`, `token attr-name` for an attribute, `token title` for a heading, `token url` for a link, and so on), puts the language on the `<pre>` as Prism's plugins do (`<pre class="language-js"><code class="language-js">`, a language with no grammar too, its code as it is), and writes a marked line (```` ```js {2} ````) as `<mark class="highlight-line highlight-line-active">`, Eleventy's syntax-highlight plugin's markup, with the other lines unwrapped. `classes: "pygments"` (or `"chroma"`, the same names) gives Pygments' short names, which MkDocs' and Hugo's themes style and Chroma (Hugo's highlighter) writes too: `k` for a keyword, `s` a string, `c` a comment, `nf` a function, `nc` a type, `m` a number, `nt` a tag, `na` an attribute, `nb` a builtin, `o` an operator, inside ssqch's `<pre class="highlight">` (the wrapper MkDocs or Hugo wrote around it, such as `<div class="highlight">`, is a fence hook's). An object names some kinds yourself and leaves the rest `hl-*`, inside ssqch's own `<pre class="highlight">`: lit.dev's CodeMirror theme is `classes: { keyword: "tok-keyword", string: "tok-string", type: "tok-typeName" }`. The kinds are the `hl-*` names without the prefix (above); another key is an error that names them, and so is a value that isn't class names. The tokens are still ssqch's (its grammars cut the code), so a theme colors them the way it colors that highlighter's, not always the same characters. `/highlight.css` uses the same names (`.token.keyword`), so it still colors the code; with a theme of your own, leave it out: `highlight: { classes: "prism", css: false }`. A fence hook's `fence.highlighted` and `highlight(code, lang)` have the same names.

```js
export default defineConfig({
  markdown: { highlight: { classes: "prism", css: false } },
});
```

## markdown-it's habits

**markdown-it's habits:** a site moving from a generator that used markdown-it can keep three of its habits without keeping markdown-it, and each one writes the bytes markdown-it 13 writes:

- **`breaks: true`:** a single newline inside a paragraph or a list item is a line break, `<br>` and the newline, as markdown-it's `breaks` option and GitHub's comments have it. A site written by many people often depends on it without knowing: 374 of a11yproject.com's line breaks did. Without it, a newline is a space, as CommonMark says.
- **`autolinks: "fuzzy"`:** besides `https://` and `www.` URLs, bare domains (`example.com`, `docs.example.org/a?b=1`) link to `http://` and bare email addresses (`ranger@example.com`) to `mailto:`, as markdown-it's `linkify` does with its defaults. A domain counts when its last part is one of linkify-it's top-level domains (`com`, `org`, `net`, `edu`, `gov`, `info`, `biz`, `name`, `pro`, `shop` and a few others, and every two-letter country code), so `node.js` stays text, but `README.md` (Moldova's `md`) becomes a link, as it does in markdown-it.
- **`figures: true`:** an image alone in a paragraph, or an image inside a link alone in one, is a `<figure>`: `![A pine cone](/cone.jpg)` is `<figure><img src="/cone.jpg" alt=""><figcaption>A pine cone</figcaption></figure>`. The alt text moves into the `<figcaption>` (with its Markdown, so `*pine*` is `<em>pine</em>`) and the image's `alt` is left empty, so a screen reader reads the caption once; an image with no alt text gets no caption. An image beside other text stays in its paragraph. It's markdown-it-implicit-figures with `figcaption: true`, which 74 of v8.dev's pages used. An image render hook (`hooks/image`) still writes the image, with `image.alt` empty.

```js
export default defineConfig({
  markdown: { breaks: true, autolinks: "fuzzy", figures: true },
});
```

## Your own Markdown library

**Your own Markdown:** to keep a Markdown library you already use (markdown-it and its plugins, say, while a move from another generator is checked byte for byte), give it to `engines` as `md`. Every `.md` file, and every `md` in a `render` chain, then renders with it instead of ssqch's Markdown, in one line of the config rather than `render` in every folder's data. The `markdownEngine` still runs first (Jinja, unless you change it), so a post's tags are rendered before your library sees the text, and `.njk`, `.jinja` and `.html` pages beside it don't change. A markdown-it instance works as it is: its `render(source, env)` gets the page's data as `env`, as Eleventy's `setLibrary("md", ...)` gave it. So does a function, `(source, data, context) => html`, or any object with a `render` method, and `context.kind` says whether it's rendering a page's body (`"body"`), a `.md` layout (`"layout"`) or a `.md` render hook (`"hook"`):

```js
import markdownIt from "markdown-it";
import markdownItAnchor from "markdown-it-anchor";
import { defineConfig } from "ssqch";

const md = markdownIt({ html: true, breaks: true }).use(markdownItAnchor);

export default defineConfig({
  markdownEngine: "liquid",
  engines: { md },
  filters: { markdown: (text) => md.render(String(text ?? "")) },
});
```

With your own Markdown, the `markdown` options, containers and render hooks no longer apply to pages: they're how ssqch's Markdown renders, and your library has its own plugins for them. Fences are your library's to highlight; `highlight: true` still writes `/highlight.css` and gives templates `highlight(code, lang)`. `page.headings` and `toc()` still work, because they read the HTML. The `markdown` filter and `markdown()` from `ssqch` stay ssqch's Markdown, so a site that wants its library there too defines a `markdown` filter of its own, as above, which takes the built-in one's place (and `markdownify`'s, Jekyll's name for it). `edge`, `html` and `txt` can't be replaced: `engines: { edge }` is an error.

**Caching an engine's pages:** a Markdown library written in JavaScript can be most of a rebuild in `ssqch serve`, which renders every page again when one changes. With `cache: true`, an engine keeps the page bodies it renders by their source, and a page whose text (after the `markdownEngine` ran over it) is the same as a page's in this build or the build before isn't rendered again: `engines: { md: { render: (source) => md.render(source), cache: true } }`. Layouts and render hooks render each time, because the same text prints something else on every page. It's for an engine whose output depends on the source alone: one that reads the page's data (a markdown-it plugin that reads `env.page.url`) would give a page another page's HTML. The cache is in memory and holds the last two builds' pages, no more: `ssqch build` saves only on pages with the same text, and `ssqch serve` keeps it from one rebuild to the next, until the config changes. `cache` works on any engine in `engines`, and anything but `true` or `false` is an error. v8.dev's rebuilds went from 1.8 s to 0.28 s with a cache like it in its config.
