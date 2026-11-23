# Honey, I Shrunk the Site

The beaver weighs her pack before every hike, so she asked what this site weighs. After
`ssqch build`:

```sh
ssqch footprint
```

It lists the build by kind of file (pages, images, CSS, feeds), then the heaviest pages and
files. Most of this site's weight is one picture: the stump, from
[the second entry](https://example.com/posts/upon-further-review-a-stump/index.md).

The camera's copy, `src/img/stump.jpg`, is 47.9 KB. The build makes six copies of it, three
widths in WebP and JPEG, 107 KB together, and the footprint weighs every one. A reader carries
only one: the browser picks the width its screen needs, in WebP when it can read it. On a phone
or a laptop's sharp screen that's the widest WebP, 14.7 KB, under a third of the camera's copy.
The JPEG copies are for browsers that can't read WebP.

To hear about it when something gets heavy, give each kind of file a budget in
`ssqch.config.js`:

```js
budgets: { pages: "50 KB", images: "40 KB" },
```

A file over its kind's budget is a warning after every build, saying which file and by how
much:

```text
warn: /img/jsuIfm9F_f-1200.jpeg (42.3 KB) is over the images budget of 40.0 KB
```

`ssqch footprint dist-before` weighs another build, to compare before and after a change, and
`--format json` gives the same numbers to a script or an agent.

The beaver's pack came in under budget. She would like that noted.
