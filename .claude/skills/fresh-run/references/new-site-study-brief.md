# New-site study brief

A study is a longer run than tasks A and B of the new-site brief: a complete site of a kind no starter fits, then seven requests from its owner, a tour of everything the agent didn't use, and checks with tools that aren't ssqch's. The requirements say what the site does and never which part of ssqch does it: whether the agent finds that part is what's measured, so don't add hints, and don't tell it anything you know.

This is `research/new-site-prompt.md` as it was on 2026-11-23. This copy is the one runs use. `research/new-site-studies-plan.md` has why each requirement is there, and the answer key (what ssqch has for each); the agent sees neither.

1. Fill in the three blanks. For **Site**, paste one section from "The sites" at the end of this file, and leave the others out.
2. Write each of "The requests" into its own file in a `requests/` folder beside the site's folder (`01.md` to `07.md`), with the words in brackets filled in from the table there. The agent opens them one at a time, in part 2.
3. Give everything between the two lines to the agent as its whole prompt, in a session started in the run's `site/` folder, not in ssqch's repository: the agent mustn't be handed ssqch's `AGENTS.md`, `research/`, or any run's notes, its own included (they're in `research/runs/`, not beside `site/`). Starting it in `site/` keeps `requests/` outside its working folder, so a search of the site doesn't read them ahead.

Keep the rest as it is, so runs can be compared.

- **Folder:** `<the run's site/ folder>`
- **ssqch:** `<"the latest release on npm" or "the tarball ../ssqch-next.tgz">`
- **Site:** `<A, B or C, pasted below>`

---

Goal: build a complete, modern website with SiteSquatch (`ssqch`), a static site generator you haven't used before, then live with it for a while, and keep an honest record of how it went. The record is used to improve ssqch: its features, its docs, its error messages, its starters and examples. What you find should point at a change to ssqch, not at cleverness on your part. The site is fictitious; make up its text and pictures (generate placeholder pictures with a script, and keep the script).

Work in **[Folder]** only (the one exception is `../requests/`, in part 2). Install ssqch there with npm: **[ssqch]** (`npm install --save-dev ssqch`, or the tarball's path in its place). Write down the version you built with (`npx ssqch --version`), your Node version, and the time you started.

How to learn it: start from what the installed package tells you (`npx ssqch --help`, `npx ssqch docs`). You may look anywhere a builder could, the website and the package's files included, but each time you leave the installed package's own help, write down what you were looking for and where you found it: that's a finding. Don't guess silently either. When you try something to see if it works, write down the guess and what happened. When ssqch has a way to do something and you choose another tool or write your own code instead, write down why: that's a finding too.

## Part 1: build it

**[Site]**

Start the site the way ssqch's docs say to start one. If nothing they offer fits this kind of site, say what you started from and why. Where a requirement leaves a choice open (a template language, a CSS tool, a host), make the choice a builder would, and write down what you chose and what made you choose it.

Part 1 is done when every numbered requirement works, `npx ssqch build` finishes with no errors and no warnings you can't explain, a second build right after it changes nothing, and a fresh copy of the folder builds the same site from its lockfile (`npm ci`, then the build). If a requirement can't be met with ssqch, prove it, write down what you tried and what you did instead, and go on.

## Part 2: live with it

The site's owner has requests, in `../requests/`, numbered. Open `01.md` only when part 1 is done, and each one only when the one before it is done. Don't read ahead: a real site isn't designed knowing next month's request. For each, write down how you found the way to do it, and how you proved it worked.

## Part 3: the tour

Now find out what you didn't use. List everything the installed package says it has: every command (and each command's options), every module it exports, every config option, and every template function or filter of its own. Write down how you found each list. In `tour.md`, give each one a line with one of these:

- **used:** where in the site.
- **tried and dropped:** what happened.
- **not for this site:** what kind of site it's for, as far as you can tell.
- **couldn't tell what it's for:** what you read, and what was missing.

Then run every command you haven't run against the finished site (with its machine-readable output too, where it has one), and for each write a line: what it told you, whether any of it was wrong or noise, and at which point in parts 1 and 2 it would have saved you time if you'd known it was there. If the tour shows a better way to do something you built by hand, say so, and say what would have led you to it sooner. Don't rebuild the site around it.

## Part 4: outside checks

ssqch's own checks passing isn't proof the site is good. Serve the production build the way a host would, and check it with tools that aren't ssqch's: an HTML validator, an accessibility checker, Lighthouse (mobile) on the three most important pages, and a validator for each feed, sitemap and block of structured data the site has. In `checks.md`, record each tool, its version, its scores and what it found. Fix what's the site's. What's ssqch's (markup or a file ssqch wrote that a validator rejects, a score that ssqch's output costs) goes in `suggestions.md` as a bug, with the validator's words.

## What to write, in `ssqch-case-study/`

Keep a **friction log** as you go (`friction-log.md`), one line per stumble, with the time: what you wanted, what you tried, what happened, and how long it cost. Write it while it's fresh, not at the end.

- **README.md:** for someone deciding whether to build this kind of site with ssqch. How long each part took and how long each numbered requirement and request took, how many builds failed that you didn't mean to fail, the versions, the top five things that cost time, and the top three that were a pleasure. Then two sections:
  - **What it's made of:** the lines you wrote, by kind (config, templates, CSS, JavaScript that runs in the build, JavaScript that runs in the browser, data, scripts beside the site); the npm packages you added and why each; every tool beside ssqch that the build or the dev loop runs, and how it's wired in; and which of those lines and packages a part of ssqch would replace, whether one that exists (and you found late) or one that doesn't.
  - **The numbers:** the first build and a second build, in seconds; how long an edit to a page, to a stylesheet and to browser JavaScript takes to show in the dev server; the output's size by kind of file; the install's size.
- **notes.md,** under four headings:
  - **Rough:** what cost time, and what would have saved it (the exact doc, message or default).
  - **Lean in:** what worked unusually well and should be kept.
  - **Needed:** what the site needed that ssqch didn't have, and what you did instead, with the lines it took.
  - **Checkpoints:** each numbered requirement and each request, smooth or rough, in a line or two.
- **lookups.md:** every time you left the installed package's help: what you were looking for, where you looked, and whether you found it. And every `ssqch docs <words>` that answered with something else: the words, what came back, and what you wanted.
- **tour.md** and **checks.md,** from parts 3 and 4.
- **suggestions.md:** changes to ssqch ranked by how much time they'd have saved you, in these groups. Mark each **every site** or **this kind of site**.
  - bugs: a wrong page or file, with the smallest site that shows it;
  - docs, with the text you wish you'd found, and the words you searched for it with;
  - error and warning messages: the message you got and the one that would have helped;
  - starters and examples: what you'd have wanted to start from, and which of this site's files would be worth shipping as one;
  - defaults: what you had to turn on that should have been on, or the other way round;
  - features: what's missing, the shape you'd expect it to have (names, arguments, an example), and what you did instead;
  - the seams: where ssqch met another tool (a CSS or JavaScript tool, a host, a search index, a browser library), what the joint cost, and what would make it smooth without ssqch taking over the other tool's job.

Out of scope: editing ssqch itself, deploying anything, committing or pushing. Don't stop until every part is done or you've proven what can't be; if something blocks you, write it down, work around it, and keep going.

---

## The requests

The same seven for every site, so sites can be compared. One file each, in `requests/`, with the words in brackets from the table below. Request 6 is only for a run that has two versions of ssqch (a release, and a tarball packed from a branch): leave it out otherwise.

1. **`01.md`, a rename.** "[Section] moving to `[new path]`: each page keeps its own name, under the new address. Every address that worked yesterday has to keep working, on the host you chose, and nothing on the site should still link to an old one. Prove both."
2. **`02.md`, where did that come from?** "A reader says [page] shows the wrong [value]. It doesn't, but next time it might. For that page, show where each of its values comes from, without reading through the templates to work it out, and write the three lines you'd give a new maintainer for finding a wrong one."
3. **`03.md`, a redesign, proven.** "Change the header and the footer on every page: [the change]. Nothing else on any page may change. Prove that it didn't, across the whole site, and say how long the proof took."
4. **`04.md`, someone else adds content.** "[Person], who isn't a developer, will add [a thing] every week. Set it up so one command gives them the file with its fields ready, and write the five lines of instructions they'll follow. Then get three fields wrong the way they would (a misspelled field name, a date that isn't one, a picture that doesn't exist) and write down, word for word, what they'd see for each."
5. **`05.md`, a second language.** "[These four pages] are needed in Spanish too, at their own addresses, with a way to switch language on each, the page's language marked for browsers and search engines, and each pair of pages pointing at each other. A page that isn't translated yet shows the English one. The site's own words (the menu, the footer, buttons) come from one place per language."
6. **`06.md`, an upgrade.** "Move the site to [the newer ssqch]. Prove its output didn't change, or list exactly what did and whether each change is wanted."
7. **`07.md`, weight, and other readers.** "Two things before launch. Set a limit on how much the site may weigh, prove the build fails when it's passed, list the three heaviest things in it and make one lighter. And people will ask AI assistants about [the subject]: make the site easy for an assistant or a crawler to read, say what AI crawlers may and may not do with it, and check that it's so."

| | Site A | Site B | Site C |
| --- | --- | --- | --- |
| 1. Section, new path (one the agent is unlikely to have chosen already; if it has, pick another) | The snacks' pages are, `/provisions/` | The brands' pages are, `/makers/` | The gear library is, `/kit/` |
| 2. Page, value | The privacy page, "last changed" date | The first product in the list, price | The first gear item, weight |
| 3. The change | A notice bar above the header, and a second column of links in the footer | A "free shipping over 50 pine cones" bar, and the footer's categories | A link to the planner in the header, and a version line in the footer |
| 4. Person, thing | The office manager, a job opening | The shop's buyer, a gear guide (an article) | A ranger, a trail tip (a short note) |
| 5. The four pages | Home, pricing, one snack, contact | Home, one category, one product, shipping | Home, how it works, one gear item, the planner's own words |
| 7. The subject | Squatch Snacks' snacks and plans | The North Fake's gear | What to pack for a trip |

## The sites

The first three. `research/new-site-studies-plan.md` has the ones that follow, as sketches; a new site's spec is added here when it's written.

### Site A: Squatch Snacks, a company's marketing site

Squatch Snacks makes trail snacks; Pine Cone Crunch is the one people know. The site sells the snacks and a subscription.

1. A home page: a hero with a large picture, three snacks picked out, what eyewitnesses say (testimonials), common questions that open and close, and an email sign-up.
2. The pieces pages are made of (a button, a card, a section with a heading, a testimonial) are written once and used on at least three pages each, with different content passed to each use.
3. Six snacks, each with its own page, from one file of data, not six hand-written pages. A snack with no price or no picture fails the build with a message that names the snack and what's missing.
4. A pricing page with three subscription plans (Day Hike, Overnight, Thru-Hike), from data. A switch between monthly and yearly prices works in the browser; with JavaScript off, the page still shows both and reads correctly.
5. A contact form and the sign-up form, working on the host you choose with no server of the site's own, with a spam trap and a thank-you page. Say how you'd try them before deploying.
6. An about page, a careers page with three openings, and privacy and terms pages that show when each was last changed, without anyone typing the date.
7. A design of the site's own: colors, type and spacing as named values in one place, a light and a dark look that follow the visitor's setting, and a layout that works from a phone to a wide screen. Write the CSS with the tool a builder would choose today (say which and why). The CSS that ships is minified, has only what the pages use, and its address changes when its content does, so a host can cache it for a year.
8. Every page has what search engines and link previews read: a title, a description, its one true address, and a preview card with a 1200 by 630 picture. Each snack's card shows that snack. The company, the snacks and the questions are also described as structured data.
9. Pictures are served in modern formats at several sizes, with nothing jumping as they load. The hero is a different crop on a phone than on a wide screen.
10. A visitor-counting script that's on the page in a production build and absent while developing.
11. Three short campaign addresses (`/go/crunch` and two more) that send people to a snack's page, and a page for addresses that don't exist.
12. The whole site also works when it's served under a path instead of at the top of a domain (`/preview/squatch-snacks/`), every link, picture and stylesheet included, with no file edited to switch between the two.
13. What the host needs to build and deploy it (Netlify or Cloudflare, your choice; don't deploy it): the build, caching between builds, long-lived caching for files whose names change with their content, and security headers.

### Site B: The North Fake, a gear catalog

The North Fake sells outdoor gear. The catalog is the site: about 120 products, kept in a spreadsheet by someone who isn't a developer.

1. The products arrive as `inventory.csv`, a spreadsheet's export: name, SKU, category, brand, price, weight in grams, colors, the date it was added, whether it's discontinued and what replaces it, a description written in Markdown, and a picture's file name. Write a script that makes up 120 of them and their placeholder pictures, and keep both. The site builds from the CSV as it is: next week's export is dropped in, and nothing else is edited.
2. A page for each product, each category and each brand, and a list of everything, 24 to a page, with numbered pages.
3. A wrong row fails the build with a message that names the row and the column: a missing price, a SKU used twice, a category that isn't one of the known ones, a picture that isn't there.
4. Every product picture is served in modern formats at several sizes. A second build doesn't do that work again. Say how long the first and second builds take, and what a host has to keep between builds for the second to be fast there too.
5. Prices are shown as currency and weights in grams and in ounces. A product added in the 30 days before the build is marked new. Two builds on the same day, on two machines in different time zones, write the same files.
6. On the list, a visitor can narrow by category, brand, price and "in stock", and sort by price or name, in the browser, with the choice kept in the address so it can be shared. With JavaScript off, the category and brand pages still do the job.
7. Search that finds a product by a word that's only in its description.
8. Stock levels come from another system: a JSON address the build asks each time (stand up a small local server to play its part). A build with no network uses the last answer it got. Say what a build does when the address is down and there's no last answer, and whether that's what a shop would want.
9. The catalog for machines: one JSON file of every product, a JSON file for each product beside its page, and a feed of the newest 20.
10. Each product page describes the product and its price as structured data, shows four related products from its category, and has a "buy" link to a checkout that lives elsewhere (no cart on this site).
11. A discontinued product keeps its address: the page says what replaced it and links there, and it's left out of the lists, the search and the sitemap.
12. Then make it big: 5,000 products (reuse the 120 pictures). Record the build time, the slowest parts of the build and how you found them, the memory it took, and how long an edit to one product and to the product page's template takes to show while developing.
13. What the host needs to build and deploy it (Netlify or Cloudflare, your choice; don't deploy it), with the build run again each night for stock and for the "new" marks.

### Site C: Pack Mule, a packing-list planner

Pack Mule helps people pack for a trip: a small web application on top of a static site. This one is a test of where a static site generator's job ends, so for every requirement, write down which part ssqch did, which part another tool did, and what joined them.

1. The static part: a home page, a "how it works" page, and a gear library of 60 items (name, category, weight in grams, a note), each with its own page, from one file of data.
2. The planner, at `/plan/`: choose a kind of trip (a day hike, an overnight, a thru-hike), tick off gear, and see the pack's total weight as you go. It's written in TypeScript, type-checked, and built for the browser with the tool a builder would choose today, with a UI library or without (say which and why). The page says something useful with JavaScript off.
3. The planner loads the same gear data the pages are built from: one source, and one description of an item's shape that both the build and the browser code are checked against.
4. A list survives a reload, and a "share" link opens the same list on another device with no server involved.
5. Saving a list: the planner sends it to a small function on the host you choose (Netlify or Cloudflare), which stores it and answers with an id, and `/lists/<id>` shows a saved list, an address nobody knows at build time. While developing, the pages and the function answer on one address, and an edit to either shows without restarting anything. Say exactly how you ran them together.
6. An address of the function's and a public key differ between development and production. They reach the browser code without being written into it by hand, and a secret the function uses appears nowhere in the built site. Prove that.
7. A search box in the gear library that asks for results as pieces of HTML and puts them in the page (HTML over the wire), with the pieces made at build time from the same template as the library's cards.
8. It works offline after the first visit and can be installed: the list of files to keep comes from what the build wrote, and a new build makes a visitor's copy update.
9. Pages send no inline scripts or styles a strict Content-Security-Policy would refuse. List anything ssqch itself wrote into a page that the policy had to allow.
10. One test that opens the planner in a real browser, ticks three items and checks the total, run against the dev server and against the production build.
11. The dev loop: how long an edit to a template, to a stylesheet, to the planner's TypeScript and to the function takes to show, and whether the planner keeps its state through each.
12. What the host needs to build and deploy the site and the function together (don't deploy it).

Then, in `ssqch-case-study/boundary.md`: for each requirement, where ssqch's job ended; what you'd want from ssqch to make it a comfortable base for a site like this, ranked, with the shape you'd expect; and what should stay another tool's job, with the reason.
