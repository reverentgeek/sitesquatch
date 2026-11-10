---
title: Your first server
---
## Write the server

Save this as `server.js` (it's `_includes/samples/server.js` in this example):

```js {3-5}
{% include "samples/server.js" -%}
```

## Run it

```sh
pinecone run server.js
```

::: warning Port 8080 is taken?
Change `port` in the call to `serve`, or set it in [the config](/docs/guides/configuration/).
:::
