---
title: Buttons
---
Use `.btn` on a `<button>` or a link.

::: example
<button class="btn" type="button">Gather cones</button>
<a class="btn btn-outline" href="/docs/colors/">See the colors</a>
:::

@component('components/callout', { type: 'warning' })
A link styled as a button still needs a real `href`.
@end

## Sass variables

Set these before importing Pinecone to change every button:

```scss
{{{ scssDocs("scss/_buttons.scss", "variables") }}}
```
