---
title: The Stump Has a Forwarding Address
date: 2026-02-05
tags: [stumps]
description: A post that moved, and the old address that still gets you here.
aliases: [/posts/where-did-the-stump-go/]
---
This entry used to be at `/posts/where-did-the-stump-go/`. I renamed it, because the stump
didn't go anywhere: it has a forwarding address. A ranger had already pinned the old link to the
station's notice board, and it still works. Try it: [the old address](/posts/where-did-the-stump-go/).

A post's address comes from its file name, so renaming the file moves the post. The old
address goes in the post's front matter:

```yaml
aliases: [/posts/where-did-the-stump-go/]
```

`redirectsPlugin()` in `ssqch.config.js` gives each old address a small page that sends
readers, and search engines, on to the new one. An old address that's another page's address
stops the build, so a redirect never hides a post.

On Netlify, `redirectsPlugin({ netlify: true })` also writes each one to `_redirects`, and
the host answers with a real 301 before the page is even asked for.

The tracks lead back to the stump. They always do.
