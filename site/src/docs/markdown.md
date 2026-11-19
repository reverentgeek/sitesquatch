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
| `headingIds` | `"github"` | Automatic heading `id`s. `"github"` matches GitHub's anchors and github-slugger's (rehype-slug's, so Astro's, VitePress's and Docusaurus's) character for character (`Hello, World!` becomes `hello-world`; letters in any script, combining accents and emoji joiners stay); `"blackfriday"` matches Hugo's older ones (`A -- B` becomes `a-b`, not `a----b`); `"ascii"` transliterates first (`Straße 🦀` becomes `strasse-crab`, like Zola's). A function of the heading's text makes your own: `headingIds: (text) => ...`. A repeated heading gets `-1`, `-2` and so on. `false` turns them off. |
| `headingAttributes` | `true` | `## Install {#setup .wide}` sets the heading's `id` and `class`. An `id` given this way always wins. Markdown that runs through Jinja or Nunjucks first (the default) keeps it: `{#` at the end of a line, closed by `}` rather than `#}`, isn't a comment there. |
| `footnotes` | `true` | `[^1]` references, with the notes in a `<section class="footnotes">` at the end and links back to each reference. |
| `taskLists` | `true` | `- [ ]` and `- [x]` items, as disabled checkboxes. |
| `autolinks` | `true` | Bare `https://` and `www.` URLs become links. |
| `alerts` | `true` | GitHub's `> [!NOTE]`, `[!TIP]`, `[!IMPORTANT]`, `[!WARNING]` and `[!CAUTION]`, as `<div class="markdown-alert markdown-alert-note">` with a title, the same markup GitHub uses (or a container template of that name, below). |
| `containers` | `true` | `::: name args` blocks (below). |
| `definitionLists` | `false` | A term, then `: definition` lines, as `<dl>`. |
| `smartPunctuation` | `false` | Curly quotes, `--` and `---` as dashes, `...` as an ellipsis. A `--` that follows a space and runs into a word stays as it is, so `run it with --fix` keeps its flag. |
| `indentedCode` | `true` | Lines indented four spaces are code. `false` makes them ordinary Markdown, for HTML indented inside Markdown; fences are still code. |
| `highlight` | `false` | Syntax highlighting at build time (below). `true`, or `{ css: "/assets/code.css" }` to put the stylesheet somewhere else, or `{ css: false }` to leave it out. `languages` adds languages or replaces built-in ones: `{ languages: { chordpro: code => tokens, cho: "chordpro", snack: "grammars/snack.sublime-syntax" } }` (below). |

**Syntax highlighting:** with `highlight: true`, fenced code is highlighted while the site builds, so pages need no highlighting script. The grammars are Sublime Text's and TextMate's (about 200 languages, from [syntect](https://github.com/trishume/syntect) and [bat](https://github.com/sharkdp/bat)), plus ssqch's own for the template languages those don't cover (`edge`, `liquid`, `hbs`, `mustache` and `ejs`: the tags, over highlighted HTML) and for ChordPro songs (`chordpro` and `cho`: directives, `[G7]` chords and comments), and each token gets one class for what it is: `hl-keyword`, `hl-string`, `hl-comment`, `hl-function`, `hl-type`, `hl-number` and so on. The build writes a stylesheet for them to `/highlight.css` (link it from your layout) with GitHub's colors, light and dark. Each color is a CSS custom property, like `--hl-keyword`, so a theme switch or your own palette only has to set those. Mark lines with braces in the fence's info string, ```` ```js {1,4-6} ````, and those lines get `class="line highlighted"`. A language without a grammar renders as plain `<pre><code class="language-x">`.

**Your own languages:** `languages`, in `highlight: { languages: { ... } }`, gives a highlighter for a language ssqch doesn't have (a custom syntax highlighter), or replaces a built-in one. Each name is a fence's language, matched in any case, and it comes before the built-in grammars. A highlighter can be a function, `(code, lang) => tokens`, that returns the code cut into tokens, as `[text, kind]` pairs or `{ text, kind }` objects, where `kind` is one of the `hl-*` names without the prefix (`comment`, `keyword`, `operator`, `string`, `regexp`, `escape`, `number`, `constant`, `builtin`, `property`, `attribute`, `function`, `type`, `parameter`, `tag`, `heading`, `strong`, `emphasis`, `link`, `inserted` or `deleted`) and a token without one (or a plain string) is plain text. ssqch escapes the text and writes the spans, so marked lines and `/highlight.css` work as they do for the built-in languages. The tokens' text has to add up to the code; when it doesn't, or the function throws or returns another kind, the build warns (naming the page) and that fence is plain text. A highlighter can also be another language's name, an alias (`cho: "chordpro"`, `jsx: "js"`), or the path of a Sublime Text `.sublime-syntax` grammar from the project root, for a language that has one. A replacement only takes the name it's given: `js: fn` leaves `javascript` fences to the built-in grammar, unless you add `javascript: "js"`. The languages apply everywhere highlighting does: fences, `highlight(code, lang)` and a fence hook's `highlighted`.

```js
// Trail notes: a line that starts with `!` is a warning, and `@Cedar` names a trail.
const trailnotes = code => code.split( /(^!.*$|@\w+)/m ).filter( Boolean ).map( text => text.startsWith( "!" ) ? [ text, "deleted" ] : text.startsWith( "@" ) ? [ text, "type" ] : [ text ] );
export default { markdown: { highlight: { languages: { trailnotes, trail: "trailnotes" } } } };
```

**A table of contents:** after a page's content renders, `page.headings` lists its headings (`level`, `id` and `text`), so its layouts can build a table of contents. The built-in `toc` filter does it for you: `{{{ toc(page.headings) }}}` writes nested `<ul>` links to the `h2` and `h3` headings, and `toc(page.headings, { from: 2, to: 4, ordered: true })` changes the levels or uses `<ol>`. `id` and `class` go on the outer list, `sublistClass` on the lists inside it, `itemClass` on each `<li>` (with `{level}` replaced by the heading's level) and `linkClass` on each link, so jekyll-toc's markup is `toc(page.headings, { class: "section-nav", itemClass: "toc-entry toc-h{level}" })`, and an unknown option is an error that lists them. In Liquid that's `{{ page.headings | toc: 2, 4 }}`, or `{{ page.headings | toc: class: "section-nav" }}` with options, and in Nunjucks, `{{ toc(page.headings) | safe }}`. The headings come from the HTML, so they work for pages in any template language. Collections have them too (`post.page.headings`). They're there once the page has rendered: in its layouts, and in a collection item after that item's `templateContent` has been read. Read in `computed`, which runs before any page renders, they're an empty list.

**Highlighting anywhere:** `highlight(code, lang)` returns the highlighted HTML for the inside of a `<code>` (escaped text for a language without a grammar), for code that isn't a Markdown fence: an example container's source, a snippet from a data file.

**The highlighting cache:** each build keeps the code it highlighted in `.cache/ssqch/highlight/fences.json`, beside `fetch`'s copies and the images, and the next build takes the HTML from there instead of loading the grammars, which is most of what highlighting costs a new process: the ReverentGeek blog's `ssqch build` takes 0.64 s with it and 1.0 s without (rendering, 48 ms against 390 ms). `ssqch serve` keeps the same fences in memory between rebuilds, so the file is for its first build and for `ssqch build`. A fence is kept by its language, code and marked lines, the site's `languages` (a `.sublime-syntax` file by its contents), and the highlighter's own version: a hash of what ssqch's highlighter is built from, so a release that changes highlighting starts afresh by itself. Fences a site's own function highlights aren't kept, because a function can answer differently each time, and `highlight(code, lang)` in a template uses the cache too. The file holds the fences the last build used and no others, it's written only when they change (beside its place, then moved in), and a build that fails doesn't write it. A file that's damaged or from another version of ssqch is ignored and written again, never an error, and the cache never changes a page: a build with it writes the same bytes as a build without. `leaveNoTrace` cleans the output, not `.cache`; delete the file (or `.cache/`) to highlight everything again, and restore `.cache/ssqch` in CI to keep it, as for images.

**Markdown anywhere:** the `markdown` filter renders a string, such as a description from front matter: `{{{ markdown(summary) }}}`, or `markdown(title, "inline")` (in Liquid, `{{ title | markdown: "inline" }}`) to leave out the `<p>`. Config and data files can `import { markdown } from "ssqch"`.

**Containers:** a block between `::: name` and `:::` renders through `_includes/containers/name.*`, a template in any engine. It gets the page's data plus `container.name`, `container.args` (the rest of the opening line, without `[` `]` around it: `:::tip[Watch out]` works), `container.props` (the arguments read as a component's attributes: `::: card type="tip" open items='["a","b"]'` is `{ type: "tip", open: true, items: ["a", "b"] }`, where a single-quoted value that starts with `{` or `[` is JSON, an unquoted one like `size=3` is the text `3`, and a word on its own is `true`), `container.slots` (below), `container.content` (the block's Markdown, rendered) and `container.source` (the block's lines as written, for an example that shows its own code). One template covers admonitions, tabs, figures or anything else that wraps content:

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
| `link.*` | `link.href`, `title`, `text` and `content` | `target="_blank"` and an icon on external links |
| `image.*` | `image.src`, `alt` and `title` | `<figure>` with a caption |
| `footnote-ref.*` | `footnote.number`, `label`, `id` (the note's), `refId` (this reference's) and `index` (1 for a note's first reference) | Footnote links in another generator's markup |
| `footnotes.*` | `footnotes`: a list of `number`, `label`, `id`, `content` (the note's HTML) and `refs` (the ids of its references) | The notes as a `<div>` each, or as sidenotes |
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
