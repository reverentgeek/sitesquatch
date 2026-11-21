---
title: "Each template language"
navTitle: "Template languages"
description: "Jinja is ssqch's default template language."
---
## Jinja and Nunjucks

Jinja is ssqch's default template language: `.jinja` (and `.j2`) pages and layouts render with ssqch's own fork of [Nunjucks](https://mozilla.github.io/nunjucks/), the library Eleventy's Nunjucks templates run on, with Jinja's filters, tests, functions and string, list and dict methods on top, so templates written for Jinja (MkDocs themes, say) run too. Markdown and HTML files run through it first. `ssqch init` starts a site in it. `.njk` files render with the same library, printing values as Nunjucks does. Add `"njk"` (Nunjucks) or `"j2"` to `templateFormats` for those extensions, `markdownEngine: "njk"` to run Markdown through the Nunjucks flavor, and `render: [njk, md]` to do that for one post. A home page, `src/index.jinja`, that lists the posts:

```jinja
---
layout: base.jinja
title: Squatch Snacks
---
{% for post in collections.posts %}
  <h2><a href="{{ post.url }}">{{ post.data.title }}</a></h2>
  <p>{{ post.date | dateformat("%B %-d, %Y") }}</p>
{% endfor %}
```

- **Data:** front matter, the cascade, `page`, `collections` and `content` in layouts, the same as in the other engines. Undefined values, and properties of undefined values, print nothing (`strict: true` makes printing one an error).
- **Escaping:** output is HTML-escaped, as in Nunjucks and Jinja; use `| safe` to opt out. A layout's `content` is already marked safe, so `{{ content }}` works, and so is what a config filter returns with `safe(html)`. `jinja: { autoescape: false }` prints `.jinja` values as they are, as MkDocs' Jinja does (`mkdocsTemplates` does that too); `| e` still escapes.
- **Filters and functions:** Jinja's built-in filters, plus Nunjucks' own (`dump`, `truncate`, `forceescape`, `nl2br`, `urlize`, `wordcount`, `center`, `random`), and `pluralize`, `filesizeformat`, `striptags`, `cycler()` and `joiner()`. Your config `filters` work both ways: `{{ title | shout }}` and `{{ shout(title) }}`. On a page whose data has a field with a function's name, the call finds the field first, so use the filter form there. An async function is awaited.
- **JavaScript properties and methods:** Nunjucks templates use JavaScript's, and they work in `.njk` and `.jinja` files alike. `.length` counts a list's items or a string's characters (`{{ collections.posts.length }}`, the same as `| length`); `loop.length` and an object's own `length` key keep their meaning, and on any other object `.length` is undefined, as in JavaScript. Strings and lists also have `startsWith()`, `endsWith()`, `includes()`, `indexOf()`, `toLowerCase()`, `toUpperCase()` and `trim()`, beside Python's (`startswith()`, `lower()`).
- **Dates:** `{{ page.date | dateformat }}` prints `Mar 14 2026`. `dateformat`, `timeformat` and `datetimeformat` take `"short"`, `"medium"`, `"long"`, `"full"`, `"iso"`, `"unix"`, or a `strftime` pattern (`dateformat("%B %-d, %Y")`), in UTC. Dates also have Python's `strftime()` and `isoformat()` and JavaScript's `toISOString()` and friends, and `now()` is the build's time.
- **Your own tags:** a config filter is a tag too, in `.njk` and `.jinja` files alike. `{% image "/a.png", "A pine" %}` prints what `image("/a.png", "A pine")` returns, without escaping it. With a closing tag, the function gets what's between them first: `{% callout "tip" %}...{% endcallout %}` calls `callout(content, "tip")`. That covers the built-in filters as well, so `{% markdown %}...{% endmarkdown %}` renders Markdown inside a template.
- **Includes and inheritance:** `{% include %}`, `{% extends %}` with `{% block %}`, `{% import %}` and `{% from ... import %}` read from `_includes`. Front-matter `layout` works too. Jinja's `self` renders a block by name anywhere in the template, as the page's templates have it (the child's over the parent's): `<title>{% block title %}Camp{% endblock %}</title> ... <h1>{{ self.title() }}</h1>`; a block nothing defines is undefined, and a variable named `self` is that variable.
- **Nunjucks syntax:** `{% elseif %}`, `===`, `{ title: x }`, `{% for key, value in object %}` and Nunjucks' own filters work in `.jinja` files as in `.njk`. Not supported: extensions that parse a tag's arguments themselves.
- **Two flavors:** `.njk` prints values as Nunjucks does, as a site from Eleventy expects (`true`, a list as `a,b`, an object as `[object Object]`, `none` as nothing, and `dump` as compact JSON, escaped unless it's followed by `| safe`; `dump(2)` indents it). `.jinja` and `.j2` print as Jinja does (`True`, `['a', 'b']`, a spaced, unescaped `dump`, and `tojson` with a dict's keys sorted, as Jinja's `json.dumps(sort_keys=True)` writes them). A date prints as ISO 8601 in both, whatever the machine's time zone.
- **The final newline:** a `.jinja` or `.j2` template (a page, a layout, an include, an import) loses one newline at its end, as Jinja's do (`keep_trailing_newline=False`), so `{% include "nav.jinja" %}` adds no blank line after the nav, and a page ends where its last tag does. `.njk` keeps it, as Nunjucks does. Templates written for Jinja (a MkDocs theme) print the same whitespace as they did there.
- **A key with a method's name:** a dict's `items`, `keys`, `values`, `get` and `update` are its methods where it has no key of that name, as in Jinja, whose `x["items"]` falls back to the method too. So `{% if link.items %}` is true for every dict: a nav entry without children included (VitePress's nav and sidebar use `items`). Ask for the key: `{% if link.get("items") %}` or `{% if "items" in link %}`. Where the key is there, `link.items` is its value, and `link.items()` is still the method.
- **Strings:** `"\u003ch1"`, `"\x3c"` and `"\U0001F332"` are the characters they name in both flavors, as in Python and JavaScript, and `\n`, `\t`, `\r`, `\\`, `\"` and `\'` work as usual. `in` searches a safe string's text (`{% if "<h1" not in page.content %}`), as Jinja searches its `Markup`.
- **Where Nunjucks isn't Jinja:** a variable set inside a loop or an `if` keeps its value after it (`{% set total = 0 %}{% for x in xs %}{% set total = total + x %}{% endfor %}` ends with the sum; `namespace()` still works), and a variable set in an include stays in the include, so set it in the page, or have the include print it. `{% break %}`, `{% continue %}`, `{% with %}`, `{% autoescape %}`, `{% for x in xs if x.ok %}` and `recursive` loops are errors that name their line and say what to write instead (an `{% if %}` inside the loop, `xs | selectattr("ok")`, a macro that calls itself). `loop.previtem`, `loop.nextitem` and `loop.depth` are undefined. Numbers have no separate float type (`{{ 4 / 2 }}` prints `2`), and `+` and `*` are JavaScript's: join lists with `xs | chain(ys)`.
- **Errors** name the template and line: `broken.njk:2: syntax error`. An error in a layout (a template that another `{% extends %}`) or after an `{% include %}` names that template's own line, not the page's `{% block %}` or the include's.


## Edge

[Edge.js](https://edgejs.dev) templates (`.edge`) render with edge.js itself (6.5), so what its documentation describes works. Add `"edge"` to `templateFormats`, and `markdownEngine: "edge"` to run Markdown through it (`ssqch init --engine edge` does both). Its components with slots are handy in Markdown: [`component-docs`](https://github.com/reverentgeek/sitesquatch/tree/main/examples/sites/component-docs/) uses them in place of MDX.

```js
export default defineConfig({
  templateFormats: ["edge", "md"],
  markdownEngine: "edge",
});
```

All of edge.js is there: `{{ }}`, `{{{ }}}`, `{{-- --}}`, `@{{ }}`, `@if/@elseif/@else/@unless`, `@each` (with index, objects, `@else` and `$loop`), `@let` (destructuring included) and `@assign`, `@include` and `@includeIf`, `@component` and `@!component` with named slots and isolated scope, `@eval`, `@inject`, `@stack` and `@pushTo`, `~` whitespace control, and edge.js's helpers (`excerpt`, `html.attrs`, `nl2br` and the rest; `nl2br` gives HTML to print as it is, so escape what it's given: `{{{ nl2br(html.escape(text)) }}}`). Expressions are JavaScript: object and array literals, template literals, optional chaining, arrow functions with block bodies, regular expressions, the `in` operator, `await`, and Node's globals (`process`, `URL`; a page's value or a config function of the same name wins). `await` waits for a promise, and an async function (an async config filter) is awaited when it's called in a mustache or `@let`. Inside a callback it's awaited in `map` (`posts.map(p => cover(p))`), and in `filter`, `find` and the others it's an error that says to call it first with `@let`.

ssqch smooths a few of edge.js's corners: an undefined value prints nothing (edge.js prints `undefined`), a call reaches the config filter when the page has a field of the same name (`{{ image(...) }}` beside `image:` in front matter), a mustache can start with an object literal (`{{ { tip: 'T' }[kind] }}`), `@let(n = n - 1)` reads the value it replaces, `reverse()` and `sort()` give copies (so a page can't reorder a collection under the next one), dates are in UTC and print as ISO 8601, strings index by character, and numbers never print in exponent notation. `{{ safe(html) }}` prints `html` as it is, as edge.js's `html.safe` does. A variable an include declares with `@let` stays in the include unless the including template declares it first. Errors report `template:line` through the include and component chain, a parse error is in edge.js's words (`parse error in page.edge: line 2: Unexpected token`), and a function that isn't there says which one you probably meant (``index.edge:2: `uper` is not a function (did you mean `upper`?)``), or ssqch's name for another generator's (`slug`).


## Liquid

Coming from Jekyll or a Shopify theme? Add `"liquid"` to `templateFormats` and `.liquid` pages and layouts render with [liquidjs](https://liquidjs.com) (10.30), the Liquid library Eleventy uses. Use `markdownEngine: "liquid"` to run Markdown through Liquid instead of Jinja, or `render: [liquid, md]` for one post.

```js
import { defineConfig } from "ssqch";

export default defineConfig({
  templateFormats: ["liquid", "md"],
  markdownEngine: "liquid",
  filters: { shout: (s) => s.toUpperCase() },
});
```

- **Data:** Liquid templates get the same data as the other engines: front matter, the cascade, `page`, `collections` and `content` in layouts. Unknown variables and properties print nothing, as in Jekyll. Front matter is at the top level (`{{ title }}`), not under `page` as in Jekyll: a template that reads `page.title` gets nothing, and the build warns once for each such name, naming the page.
- **Filters:** liquidjs' standard filters and tags (`where_exp`, `sum`, `{% liquid %}`, `{% echo %}`), Jekyll's `push`, `pop`, `shift`, `unshift`, `array_to_sentence_string`, `date_to_xmlschema`, `date_to_rfc822`, `date_to_string` and `date_to_long_string`, and Shopify's `pluralize`. `slugify` is ssqch's, the same as in the other languages. Your config `filters` work too: `{{ title | shout }}` calls `shout(title)`, and `{{ x | wrap: "[", "]" }}` calls `wrap(x, "[", "]")`. A config filter replaces a built-in one with the same name.
- **Dates** print as `2026-01-02 00:00:00 +0000`, in UTC, whatever the machine's time zone, in every filter, and `date` reads ISO 8601 text (`2024-03-04`).
- **Objects:** `{{ some_object }}` prints `[object Object]`, so write `{{ some_object | json }}`; `{{ some_object.size }}` is its number of keys, and a string's `size` counts as JavaScript does (`café` is 4). A variable named `empty` or `blank` is Liquid's keyword (`{% if empty %}`), so rename it.
- **Includes:** `{% include "nav.html" %}` and Jekyll's `{% include nav.html section="home" %}` (read as `include.section`) see the page's variables. `{% render "footer", year: 2026 %}` sees only what it's given, and prints nothing for a variable it wasn't given (with `strict`, that is an error). Both read from `_includes`, adding `.liquid` when the name has none.
- **`include_relative`:** Jekyll's `{% include_relative parts/intro.md who="rangers" %}` reads a file beside the template that has the tag (or in a folder below it), not in `_includes`, and renders it with the page's variables and `include.who`. The name can have `{{ }}` in it (`parts/{{ lang }}.md`); `..` is refused, as in Jekyll. The file is read as it is, front matter and all, and a Markdown file there is a page of its own too, so give it `permalink: false` in directory data (not in its front matter) or keep it out with `ignore`.
- **Your own tags:** a config filter is a tag too, as in Nunjucks, so a Jekyll plugin's tag can be a function: `{% seo %}` prints what `seo()` returns, without escaping it. Arguments are values, by commas or spaces (`{% image "/a.png", "A pine" %}`), and `name: value` or Jekyll's `name=value` arrive as one object at the end (`{% seo title=false %}` calls `seo({ title: false })`). With a closing tag, the function gets what's between them first: `{% callout "tip" %}...{% endcallout %}` calls `callout(content, "tip")`. A function can be async. Liquid's own tags keep their names: a filter called `include` is a filter only. Arguments are plain values: a filter inside a tag's arguments (`{% image page.cover | url %}`) is an error, so `assign` it first.
- **Ruby's Liquid:** math, `split` and blank blocks follow Ruby's Liquid (4.0.4, Jekyll's and GitHub Pages'): `plus`, `minus`, `times`, `divided_by`, `modulo` and the rest read text as Ruby does (`"3.5"` is a float, `"3.5x"` is 3, `"r>"` and nothing are 0); `split` drops empty strings at the end and splits `" "` at every run of whitespace; and an `if`, `unless`, `for` or `case` whose bodies are only whitespace, `assign`, `capture` and comments writes nothing, so a layout that computes in blocks doesn't fill with blank lines. Dividing by zero is still an error.
- **Mixing engines:** a Liquid page can use a Jinja layout and the other way around.
- **Errors** name the file and line, and an unknown filter gets the closest name (`did you mean`).


## Handlebars and Mustache

Add `"hbs"` (or `"handlebars"`) or `"mustache"` to `templateFormats`, and those files render with [handlebars.js](https://handlebarsjs.com) (4.7). Mustache templates render as Handlebars.

- **Data:** the same as the other engines, so a template reads the page's real data and collections, and a missing value prints nothing. A date passed to a helper itself (`{{year date}}`) arrives as ISO 8601 text, and one inside an object the helper is given (`{{byline post}}`) is a `Date`.
- **Escaping:** `{{ }}` escapes HTML and `{{{ }}}` doesn't, so a layout writes `{{{content}}}`.
- **Helpers:** Handlebars' built-ins (`if`, `unless`, `each`, `with`, `lookup`, `len`, `eq` and the other comparisons). Your config `filters` are helpers: `{{shout title}}`, `{{wrap title "[" "]"}}`, and hash arguments (`size=2`) arrive as a trailing object. An unknown helper gets the closest name (`did you mean`). Use `{{len list}}`, not `list.length`.
- **Partials:** every file in `_includes`, by its path with or without the extension: `{{> nav}}` or `{{> nav.hbs}}`. A name without an extension is the Handlebars file when there is one.
- **Mustache:** variables, `{{{ }}}`, partials, sections over lists and truthy values (`{{#items}}{{.}}{{/items}}`) and inverted sections (`{{^items}}none{{/items}}`), also in `.hbs` files. Inside a section, reach outer values with `../name`, as in Handlebars. Not supported: lambdas and changing delimiters.
- **Errors** name the file and line, and an error in a partial names the partial's file.


## EJS

[EJS](https://ejs.co/) templates (`.ejs`) are plain JavaScript between tags, rendered with ejs 3.1, which is bundled in ssqch (no npm install). Add `"ejs"` to `templateFormats`, and `markdownEngine: "ejs"` to run Markdown through it. The output matches EJS 3's, whitespace included.

```ejs
<ul>
  <%_ for (const post of collections.posts) { _%>
    <li><a href="<%= post.url %>"><%= post.data.title %></a></li>
  <%_ } _%>
</ul>
```

- **Tags:** `<% code %>`, `<%= escaped %>`, `<%- raw %>` (a layout writes `<%- content %>`), `<%# comment %>` and `<%%` for a literal `<%`. `-%>` drops the newline after a tag, and `<%_`/`_%>` the spaces and tabs around it too.
- **Data:** the page's data, as variables (`title`, `page`, `collections`, and `locals` for all of it). Your config `filters` and ssqch's functions (`markdown`, `highlight`, `navTree`, ...) are functions by the same names: `<%= shout(title) %>`. A config filter is called directly, without converting anything.
- **Async:** a function's promise that's printed (`<%= later(x) %>`) is awaited, and a template can `await`.
- **Dates** print at UTC (`Sun Apr 05 2026 06:07:08 GMT+0000`), in `<%= %>`, `<%- %>` and lists, whatever the machine's time zone. Format a date in the template to show it otherwise (`date.toLocaleString("en-US", { timeZone: "America/New_York" })`).
- **Includes:** `<%- include("partials/nav") %>` reads `_includes/partials/nav.ejs` (and the themes'), `include("./card")` reads from the template's own folder, and a second argument adds variables: `include("card", { post })`. One that isn't there says which file you probably meant.
- **Errors** name the template and line, and the lines under them are the file's own. A variable nothing defines is a `ReferenceError`, as in EJS (`typeof x` is still safe).
- **Starters:** `ssqch init --engine ejs` (and `--starter docs --engine ejs`) writes the starters' layouts, render hook and containers in EJS.
