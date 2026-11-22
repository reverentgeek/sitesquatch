---
title: Configuration
description: "Pinecone's config file, pinecone.toml, and every server option it takes: port and trust_proxy, with their defaults."
---
## The config file

```toml
{% include "samples/pinecone.toml" -%}
```

### Every option

::: details All server options
- `port`: the port to listen on (default 8080).
- `trust_proxy`: trust `X-Forwarded-For` (default false).
:::
