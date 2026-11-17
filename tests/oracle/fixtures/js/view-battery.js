// The same operations on a view and on a plain copy must give the same results.
export function copy(v) {
  if (v instanceof Date) return new Date(v.getTime());
  if (Array.isArray(v)) return v.map(copy);
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, copy(x)]));
  return v;
}

export function battery(d) {
  const r = {};
  const posts = d.posts;
  r.isArray = Array.isArray(posts);
  r.length = posts.length;
  r.keys = Object.keys(d);
  r.entries = Object.entries(d.site).map(([k, v]) => k + "=" + v);
  r.json = JSON.stringify(d);
  r.spread = JSON.stringify({ ...d.site, extra: 1 });
  r.arraySpread = [...posts].map((p) => p.title);
  r.forOf = []; for (const p of posts) r.forOf.push(p.title);
  r.forIn = []; for (const k in d.site) r.forIn.push(k);
  r.mapped = posts.map((p) => p.title.toUpperCase());
  r.filtered = posts.filter((p) => p.tags.includes("snacks")).length;
  r.found = posts.find((p) => p.stars > 4)?.title;
  r.findIndex = posts.findIndex((p) => p.title === "Yeti Yogurt");
  r.indexOfSelf = posts.indexOf(posts[1]);
  r.includesSelf = posts.includes(posts[2]);
  r.sameChild = d.site === d.site && posts[0] === posts[0];
  r.has = ["title" in d.site, "nope" in d.site, 0 in posts, 99 in posts, "length" in posts];
  r.hasOwn = [Object.hasOwn(d.site, "title"), d.site.hasOwnProperty("nope"), Object.prototype.hasOwnProperty.call(posts, "1")];
  r.typeofs = [typeof d, typeof posts, typeof d.site.title, typeof d.posts[0].date, d.posts[0].date instanceof Date];
  r.dateTime = posts[0].date.getTime();
  r.sortedCopy = [...posts].sort((a, b) => a.stars - b.stars).map((p) => p.title);
  r.slice = posts.slice(1, 3).map((p) => p.title);
  r.reduce = posts.reduce((n, p) => n + p.stars, 0);
  r.join = posts.map((p) => p.stars).join("-");
  r.destructure = (({ title, author = "?" }) => `${title}/${author}`)(d.site);
  r.assign = JSON.stringify(Object.assign({}, d.site));
  r.string = [String(posts.map((p) => p.stars)), Object.prototype.toString.call(posts), Object.prototype.toString.call(d.site)];
  r.missing = [d.nope, d.site.nope, posts[99]];
  r.nestedLen = d.posts[2].tags.length;
  r.flat = posts.flatMap((p) => p.tags);
  r.every = [posts.every((p) => p.stars > 0), posts.some((p) => p.stars > 4)];
  r.objectValues = Object.values(d.site);
  r.getOwnNames = Object.getOwnPropertyNames(d.site);
  r.arrayKeys = Object.keys(posts);
  r.lastAt = posts.at(-1).title;
  // In-place mutation, in Node style.
  posts.sort((a, b) => b.stars - a.stars);
  r.sortedInPlace = posts.map((p) => p.title);
  posts.reverse();
  posts.push({ title: "Sasquatch Sorbet", stars: 3, tags: [] });
  r.afterPush = [posts.length, posts.at(-1).title];
  r.popped = posts.pop().title;
  posts.splice(0, 1);
  r.afterSplice = posts.map((p) => p.title);
  d.site.title = "Renamed";
  d.site.added = true;
  delete d.site.author;
  r.mutatedSite = JSON.stringify(d.site);
  r.mutatedKeys = Object.keys(d.site);
  posts[0].stars = 99;
  r.nestedWrite = posts[0].stars;
  posts.length = 1;
  r.truncated = JSON.stringify(posts);
  r.frozen = Object.isFrozen(d.site);
  return r;
}
