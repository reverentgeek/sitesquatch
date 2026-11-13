---
title: The Cache of the Wild
date: 2026-01-29
description: A raccoon, the trail conditions, and a copy for when the network is down.
---
The raccoon keeps a dated copy of the trail conditions. He checks the ranger station once a
day, and the rest of the time he reads you his copy. When the station doesn't answer, he reads
you his copy anyway and mentions how old it is.

A data file that asks a server for something can do the same. Save this as
`src/_data/conditions.js`, and every page has `conditions`:

```js
export default async function () {
  // Asked once a day; until then, the saved copy in .cache/ssqch/fetch/.
  const response = await fetch("https://api.example.com/trails/cedar", { cache: "1d" });
  return response.json();
}
```

- While `ssqch serve` rebuilds on every save, the server is asked once a day, not once a save.
- When the server is down and there's a copy, the build uses it and says how old it is.
- `ssqch build --offline` uses only the saved copies, whatever their age, so a build on a plane
  never touches the network.

The raccoon has never been on a plane. He has opinions about the Old Growth trail.
