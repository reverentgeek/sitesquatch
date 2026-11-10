# islands

Interactivity without a framework, in Edge. It's what an Astro or Eleventy "islands" site looks like in ssqch: static HTML, with a few custom elements whose scripts load only where they're used.

What it shows:

- `elementsPlugin()` from `ssqch/elements`: each file in `src/elements/` named like a custom element (`like-button.js`) is that element's script, and `like-button.css` next to it is its stylesheet. A page gets the scripts and stylesheets of the tags it has. The home page loads two elements, the trails page two, and the about page loads no JavaScript at all.
- When a script loads: `ssqch:load="idle"` on `<local-time>` waits for a quiet moment, and `ssqch:load="visible"` on `<trail-filter>` waits until the list scrolls into view. Without the attribute, a script loads with the page.
- Fallbacks: what's inside each tag is what a visitor without JavaScript sees (a time in UTC, a link, the whole list), and the element replaces or adds to it.
- Shared code: `src/elements/shared/storage.js` has no hyphen in its name, so it isn't an element; `like-button.js` imports it, and the whole folder is copied to `/elements/`.

Build it with `ssqch build`, or `ssqch serve` to click the buttons.
