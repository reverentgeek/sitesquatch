---
title: Crunchy season
date: 2024-06-01
tags: [pine-cones]
---
Summer means crunchy pine cones. Squirrel sorts them for us, and this is her method:

```rust
fn crunchiest(cones: &[Cone]) -> Option<&Cone> {
    cones.iter().max_by_key(|c| c.crunch)
}
```
