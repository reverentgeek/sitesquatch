---
title: "JavaScript data files"
navTitle: "Data files"
description: "_data/*.js files are global data, and *.data.js files next to a template or in a folder (posts/posts.data.js) are template and directory data."
---
`_data/*.js` files are global data, and `*.data.js` files next to a template or in a folder (`posts/posts.data.js`) are template and directory data. The default export is the data, or a function (sync or async) that returns it:

```js
// src/_data/snacks.js
import { readFile } from "node:fs/promises";

export default async function () {
  return JSON.parse(await readFile("data/snacks.json", "utf8"));
}
```

```js
// src/posts/posts.data.js
export default {
  tags: "posts",
  computed: {
    permalink: (data) => `/snacks/${data.page.fileSlug}/`,
  },
};
```

Data functions run on every build. `ssqch serve` reloads a data file when it changes, and the modules it imports too. Data files work in TOML-configured sites too.

**Files as data:** `files()` from `ssqch` lists the files a glob matches, for a photo album made from a folder or a page of downloads, without `readdirSync` and a date parser of your own:

```js
// src/_data/campPhotos.js
import { files } from "ssqch";

export default files("images/camp/*.{jpg,png}", { dimensions: true }).map((photo) => ({
  src: photo.url,
  width: photo.width,
  height: photo.height,
  taken: photo.date,
}));
```

- `files(pattern, { dimensions })`: the files `pattern` matches, from the project root, sorted by path. Each is `{ path, url, name, stem, ext, date, dateFrom, size }`: `path` from the project root (`images/camp/20011222_08.JPG`); `url` where a passthrough copy to the same path is served, from the input folder when the file is inside it (`src/images/a.jpg` is `/images/a.jpg`), otherwise from the project root (`/images/camp/20011222_08.JPG`); `name` (`20011222_08.JPG`), `stem` (`20011222_08`) and `ext` (`jpg`, lowercase); `date`, a date from the start of the name (`20011222_08.JPG` or `2001-12-22-camp.jpg`, at midnight UTC) or else the file's modification time; `dateFrom`, which says which (`"name"` or `"modified"`: a modification time is when the file was copied or edited, not when a photo was taken, so test `photo.dateFrom === "name"` before captioning one with its date); and `size` in bytes. The glob ignores case, so `*.jpg` finds `.JPG`, and `*` stops at `/` (`**` crosses folders). `{ dimensions: true }` adds `width` and `height`, read from each image's header: PNG, JPEG, GIF, TIFF, WebP, HEIF and AVIF, BMP, PSD, ICO and QOI files have them, and every other file (an EXR, a JPEG XL, a TGA, a text file) gets `null`. The first read takes a moment for a thousand photos (about 100 ms from a cold disk), so it's off by default; the sizes are kept in `.cache/ssqch/image-sizes.json` by path, size and modification time, so later builds read only new and changed files. No match is an empty list; a glob that isn't one, or that leaves the project (`../`, an absolute path), is an error naming the call. It lists files, nothing more: copy them to the output with `passthrough`, and resize them with `imagePlugin()`. In `ssqch.config.js` before the first build, `url` is from the project root, since the input folder isn't known yet.

**Unique slugs:** two items with the same title (two albums called "Misc Pictures") give a paginated template the same permalink, and the build stops with `output conflicts`, naming both. Make the slugs different in the data, with `slugger()` from `ssqch`, so the page's permalink and every link to it use the same one:

```js
// src/_data/albums.js
import { readData, slugger } from "ssqch";

const slug = slugger();
export default readData("data/albums.json").map((album) => ({ ...album, slug: slug(album.name) }));
```

- `slugger({ separator })`: a function that slugifies like `slugify(text, { separator })` and counts what it has made: the first `Misc Pictures` is `misc-pictures`, the next `misc-pictures-1`, then `misc-pictures-2`, skipping a number another title already took. Each `slugger()` counts on its own, so make one per list. In the template, `permalink: "photos/{{ album.slug }}/"` and the index page's `<a href="/photos/{{ album.slug }}/">` agree. `slugify(text, { separator })` from `ssqch` is the template filter, for data files.

**A spreadsheet's export (CSV):** `readData()` reads JSON, YAML and TOML, not CSV, so a data file parses it with a package from npm (`npm install csv-parse`), and checks each row as it goes, so a wrong row stops the build with the spreadsheet's row and column. Content schemas check pages, not rows, and can't see a value used twice in a column, so a check like that is a line in the data file too. The file is outside the input folder, so `watch: ["inventory.csv"]` in the config makes `ssqch serve` rebuild when it changes:

```js
// src/_data/products.js
import { readFileSync } from "node:fs";
import { parse } from "csv-parse/sync";

export default function () {
  const rows = parse(readFileSync("inventory.csv"), { columns: true, bom: true, skip_empty_lines: true, info: true });
  return rows.map(({ record, info }) => {
    // The spreadsheet's row: the header is row 1.
    const row = info.records + 1;
    if (!record.Price) throw new Error(`inventory.csv row ${row}, column "Price": empty`);
    return { name: record.Name, sku: record.SKU, price: Number(record.Price) };
  });
}
```

A missing price stops the build there: `error: src/_data/products.js: inventory.csv row 3, column "Price": empty`. A page for each product is `pagination: { data: products, size: 1, alias: product }`. The [searchable-directory example](https://github.com/reverentgeek/sitesquatch/tree/main/examples/sites/searchable-directory) is a catalog's shape end to end: a page for each record, a list with numbered pages, filters in the browser, and Pagefind.
