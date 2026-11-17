---
title: Raiders of the Lost Path
date: 2026-01-22
description: An old map, a renamed heading, and the build that caught it.
---
A ranger came by with an old map of these notes. It pointed to a heading called "The tracks".
I had renamed it "Where they lead" the week before. The ranger was not pleased, and neither
was the build.

## What the build said

The link checker (`linksPlugin()` in `ssqch.config.js`) follows every link inside the site
after a production build. A link to a page that isn't there, or to a heading that isn't on it,
fails the build and says where:

```text
error: after_build hook failed: the trail goes cold on 1 broken link:
  /posts/i-know-what-i-saw/ -> /posts/the-stump-has-moved/#the-tracks (no id "the-tracks" on that page)
```

## The correction

A heading's id comes from its text, so renaming a heading moves its address. Point the link at
the new one, `#where-they-lead`, or keep the old heading. In `ssqch serve` it's a warning, so
you can keep writing while you look for it.

This link works, for comparison: [back to what the build said](#what-the-build-said).
