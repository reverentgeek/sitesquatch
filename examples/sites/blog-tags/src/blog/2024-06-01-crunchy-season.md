---
title: Crunchy season
description: "Summer means crunchy pine cones: Squirrel's method for sorting them, and the one-line function that finds the crunchiest."
date: 2024-06-01
tags: [pine-cones]
---
Summer means crunchy pine cones. Squirrel sorts them for us, and this is her method:

```rust
fn crunchiest(cones: &[Cone]) -> Option<&Cone> {
    cones.iter().max_by_key(|c| c.crunch)
}
```
