---
title: Hello, Squatch
date: 2024-01-15
tags: [announcements, pine-cones]
aliases: [/2024/01/15/hello-squatch.html]
---
Welcome to the blog. We'll write about forest snacks and the tools we build.[^tools]

## Getting the snacks

```js {2}
const snacks = await forage({ kind: "pine-cone" });
console.log(`Found ${snacks.length} snacks`);
```

[^tools]: Mostly static site generators.
