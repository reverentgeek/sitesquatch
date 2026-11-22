# New-site brief

Fill in the three blanks, then give everything below the line to the agent as its whole prompt. Keep the rest as it is, so runs can be compared.

- **Folder:** `<the run's site/ folder>`
- **ssqch:** `<"the latest release on npm" or "the tarball ../ssqch-next.tgz">`
- **Task:** `<A or B>`

---

Goal: build a small website with SiteSquatch (`ssqch`), a static site generator you haven't used before, and keep an honest record of how it went. The record is used to improve ssqch: its docs, its error messages and its starters. What you find should point at a change to ssqch, not at cleverness on your part.

Work in **[Folder]** only. Install ssqch there with npm: **[ssqch]** (`npm install --save-dev ssqch`, or the tarball's path in its place). Write down the version you built with (`npx ssqch --version`).

How to learn it: start from what the installed package tells you (`npx ssqch --help`, `npx ssqch docs`). You may look anywhere a builder could, the website and the package's files included, but each time you leave the installed package's own help, write down what you were looking for and where you found it: that's a finding. Don't guess silently either. When you try something to see if it works, write down the guess and what happened.

## Task A: a blog

1. Start the site the way ssqch's docs say to start one.
2. Five posts in Markdown, each with a title, a date, tags and a description. One has a code block in two languages, one has a picture, and one has a table and a footnote.
3. A home page that lists the posts, newest first, with their dates and descriptions.
4. A page for each tag that lists its posts, and a page that lists the tags.
5. An Atom or RSS feed, and a sitemap.
6. The picture is served in modern formats at several sizes.
7. An about page written in a template language other than the one the posts' layout uses.
8. Check the site: no broken links, and `ssqch patrol` all clear, or each thing it reports explained.
9. Run the dev server, edit a post, and confirm the page shows the edit.
10. Add what a host needs to build and deploy it on Netlify or Cloudflare (your choice; don't deploy it).

## Task B: a docs site

1. Start a documentation site the way ssqch's docs say to start one.
2. Ten pages in two sections, with a sidebar that shows both sections and marks the current page.
3. One page with tabs and a callout, one with a code block that marks two of its lines, and one with a table of contents built from its headings.
4. Search that finds a word used on only one page.
5. A link on every page to that page as Markdown, and an `llms.txt`.
6. One page whose front matter is wrong on purpose (a missing title, a date that isn't one), caught by a check that names the file and the field. Then fix it.
7. Check the site: no broken links, and `ssqch patrol` all clear, or each thing it reports explained.
8. Run the dev server, edit a page, and confirm the page shows the edit.
9. Add what a host needs to build and deploy it on Netlify or Cloudflare (your choice; don't deploy it).

## Done when

Every numbered step works, `npx ssqch build` finishes with no errors and no warnings you can't explain, and a second build right after it changes nothing. If a step can't be done with ssqch, prove it, write down what you tried, and go on to the next step.

## What to write, in `ssqch-case-study/`

Keep a **friction log** as you go (`friction-log.md`), one line per stumble, with the time: what you wanted, what you tried, what happened, and how long it cost. Write it while it's fresh, not at the end.

- **README.md:** for someone deciding whether to use ssqch. How long the whole task took and how long each step took, how many times a build failed, the version, and the top five things that cost time.
- **notes.md,** under four headings:
  - **Rough:** what cost time, and what would have saved it (the exact doc, message or default).
  - **Lean in:** what worked unusually well and should be kept.
  - **Needed:** what the site needed that ssqch didn't have, and what you did instead.
  - **Checkpoints:** each numbered step, smooth or rough, in a line or two.
- **lookups.md:** every time you left the installed package's help: what you were looking for, where you looked, and whether you found it.
- **suggestions.md:** changes to ssqch ranked by how much time they'd have saved you, in these groups: docs (with the text you wish you'd found), error and warning messages (the message you got and the one that would have helped), the starters, defaults, and missing features.

Out of scope: editing ssqch itself, deploying anything, committing or pushing. Don't stop until every step is done or you've proven it can't be; if something blocks you, write it down, work around it, and keep going.
