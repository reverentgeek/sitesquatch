---
title: Upon Further Review, a Stump
date: 2026-01-08
description: A correction to the previous entry.
---
I went back in daylight. It was a stump. A tall one, to be fair to me.

The `description` in this post's front matter is the page's meta description; posts without
one get the site's, from `src/_data/site.json`.

I didn't take a picture, since it was a stump. When you have one worth showing, save it as
`src/img/stump.jpg` and write `![The stump](/img/stump.jpg)`. The build turns it into a
`<picture>` in three sizes, so it stays sharp on any screen. Whether it was sharp to begin
with is between you and your camera.

A raccoon who keeps everything told me the trick for deploying: keep `dist/img/` and
`.cache/` between builds, and the build never encodes the same picture twice. Raccoon's cache.
Raccoon did not see anything tall.
