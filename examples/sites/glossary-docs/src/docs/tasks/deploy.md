---
title: Deploy your first pod
weight: 3
aliases: /docs/getting-started/
---
{% from "macros.njk" import term with context %}
## Before you begin

You need a clearing with at least one {{ term("node") }}. Read [Pods](/docs/concepts/pods/) first.

## Deploy it

```sh
squatchctl run snack-finder --image=forage:1.0
```

Old links to [the getting started page](/docs/getting-started/) still work.
