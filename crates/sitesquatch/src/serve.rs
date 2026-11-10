//! Development server: static file server, file watcher and live reload.
//!
//! A change to the site's sources rebuilds it, and the browser reloads if
//! the page it's showing came out different (a rebuild leaves identical pages
//! alone). A changed stylesheet is swapped in place, without a reload. A CSS
//! or JavaScript file that another tool writes into the output folder (a
//! PostCSS or esbuild watcher, say) reaches the browser without a rebuild,
//! so a page never reloads before its new CSS is there. A build that fails
//! is shown over the page, until one works.

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::{mpsc, Arc, Mutex, RwLock};
use std::time::{Duration, SystemTime};

use anyhow::{Context, Result};
use notify::{RecursiveMode, Watcher};

use crate::config::Config;

/// The script added to each HTML page the server sends. It asks
/// `/__ssqch/build` what changed since it last looked.
const LIVE_SCRIPT: &str = include_str!("live.js");

/// The footprint in [`NOT_FOUND_PAGE`], as the tab's icon for a site that has
/// no `favicon.ico`: `{fill}` is its colour.
const FOOTPRINT_ICON: &str = r#"<svg xmlns="http://www.w3.org/2000/svg" viewBox="-40 0 200 200" fill="{fill}"><path d="M62 72c27 0 39 22 35 56-4 31-13 64-37 64s-32-33-35-64c-3-34 10-56 37-56z"/><circle cx="20" cy="62" r="8"/><circle cx="37" cy="44" r="9"/><circle cx="57" cy="33" r="10"/><circle cx="79" cy="30" r="11"/><circle cx="102" cy="42" r="14"/></svg>"#;

/// The page for a URL that isn't there, when the site has no `404.html` of
/// its own. Only the dev server sends it: it's never written to the output.
const NOT_FOUND_PAGE: &str = include_str!("not-found.html");

/// Serve the site as `cfg` describes it. Changes to its configuration need a
/// restart; [`serve_reloading`] picks those up too.
pub fn serve(cfg: &Config, port: u16) -> Result<()> {
    let live = Arc::new(Live::default());
    let site = Arc::new(RwLock::new(Site::of(cfg)));
    let server = listen(port, &site, &live)?;
    println!("{} Serving {} at http://localhost:{}{}/", crate::voice::SQUATCH_WATCH, site.read().unwrap().output.display(), server, site.read().unwrap().base);
    watch(cfg, &live, &|_| {}, &|| {
        println!("Restart to use the changed configuration.");
        false
    })
    .map(|_| ())
}

/// How [`serve_reloading`] serves.
#[derive(Debug, Clone, Default)]
pub struct ServeOptions {
    /// The port to listen on; 0 picks a free one.
    pub port: u16,
    /// A file to write once the first build is done and the site is being
    /// served: JSON with the `url`, the `port`, the `output` folder, this
    /// process's `pid`, and `ok` (whether that build worked). A script waits
    /// for the file instead of reading the server's output. It's deleted at
    /// the start, and written again when a changed configuration loads.
    pub ready_file: Option<PathBuf>,
}

/// Write the ready file in one step, so a reader never sees half of it.
fn write_ready(path: &Path, site: &Site, port: u16, ok: bool) -> Result<()> {
    let output = dunce::canonicalize(&site.output).unwrap_or_else(|_| site.output.clone());
    let ready = serde_json::json!({
        "schemaVersion": 1,
        "url": format!("http://localhost:{}{}/", port, site.base),
        "port": port,
        "base": site.base,
        "output": output.to_string_lossy(),
        "pid": std::process::id(),
        "ok": ok,
    });
    let partial = path.with_extension("partial");
    std::fs::write(&partial, format!("{}\n", serde_json::to_string_pretty(&ready)?)).with_context(|| format!("--ready-file: writing {}", partial.display()))?;
    std::fs::rename(&partial, path).with_context(|| format!("--ready-file: writing {}", path.display()))
}

/// [`serve`], reading the configuration again (with `reload`) when one of
/// the files it came from changes ([`Config::add_config_file`]). If the new
/// configuration doesn't load, the error is printed and the last good one
/// keeps serving.
pub fn serve_reloading(first: Config, options: &ServeOptions, reload: &dyn Fn() -> Result<Config>) -> Result<()> {
    let live = Arc::new(Live::default());
    let site = Arc::new(RwLock::new(Site::of(&first)));
    if let Some(ready) = &options.ready_file {
        // One from an earlier run would say this server is ready already.
        match std::fs::remove_file(ready) {
            Err(e) if e.kind() != std::io::ErrorKind::NotFound => return Err(e).with_context(|| format!("--ready-file: removing {}", ready.display())),
            _ => {}
        }
    }
    let server = listen(options.port, &site, &live)?;
    println!("{} Serving {} at http://localhost:{}{}/", crate::voice::SQUATCH_WATCH, site.read().unwrap().output.display(), server, site.read().unwrap().base);
    let mut cfg = first;
    loop {
        *site.write().unwrap() = Site::of(&cfg);
        let next: std::cell::RefCell<Option<Config>> = Default::default();
        // Returns once a changed configuration has loaded.
        let built = |ok: bool| {
            if let Some(ready) = &options.ready_file {
                if let Err(e) = write_ready(ready, &site.read().unwrap(), server, ok) {
                    eprintln!("{} {:#}", crate::diagnostics::red("error:"), e);
                }
            }
        };
        let Reloaded = watch(&cfg, &live, &built, &|| match reload() {
            Ok(new) => {
                *next.borrow_mut() = Some(new);
                true
            }
            Err(e) => {
                eprintln!("{} {:#}\n(still serving with the last configuration that loaded)", crate::diagnostics::red("Config error:"), e);
                false
            }
        })?;
        cfg = next.into_inner().expect("watch returns after a reload");
    }
}

/// What the HTTP server needs to know about the site, which a reloaded
/// configuration can change.
struct Site {
    output: PathBuf,
    base: String,
}

impl Site {
    fn of(cfg: &Config) -> Site {
        let ctx = cfg.build_context();
        Site { output: ctx.output_dir, base: ctx.base }
    }
}

/// Start answering requests on a thread. Returns the port.
fn listen(port: u16, site: &Arc<RwLock<Site>>, live: &Arc<Live>) -> Result<u16> {
    let server = tiny_http::Server::http(("127.0.0.1", port)).map_err(|e| match e.downcast_ref::<std::io::Error>() {
        Some(io) if io.kind() == std::io::ErrorKind::AddrInUse => anyhow::anyhow!("can't listen on port {}: something else is squatting on it (--port 0 picks a free one)", port),
        _ => anyhow::anyhow!("can't listen on port {}: {}", port, e),
    })?;
    let port = server.server_addr().to_ip().map(|a| a.port()).unwrap_or(port);
    let (site, live) = (site.clone(), live.clone());
    std::thread::spawn(move || {
        for request in server.incoming_requests() {
            let (output, base) = {
                let site = site.read().unwrap();
                (site.output.clone(), site.base.clone())
            };
            let _ = handle(request, &output, &live, &base);
        }
    });
    Ok(port)
}

/// Returned by [`watch`] when the configuration changed and loaded again.
struct Reloaded;

/// Build, then watch the site's sources and rebuild when they change. When a
/// file the configuration came from changes, `reload` is called: if it
/// returns true, this returns (the caller has a new configuration to watch
/// with); if not, the watch goes on.
fn watch(cfg: &Config, live: &Live, first_build: &dyn Fn(bool), reload: &dyn Fn() -> bool) -> Result<Reloaded> {
    let ctx = cfg.build_context();
    let (mut built_at, ok) = run_build(cfg, live);
    first_build(ok);

    let (tx, rx) = mpsc::channel();
    let mut watcher = notify::recommended_watcher(move |res: notify::Result<notify::Event>| {
        if let Ok(event) = res {
            // Reading a file isn't a change. Linux reports each open and close, so the
            // server's own reads (and an editor's, or an indexer's) would look like one.
            if !matches!(event.kind, notify::EventKind::Access(_)) {
                let _ = tx.send(event.paths);
            }
        }
    })?;
    let watch_paths: Vec<PathBuf> = cfg.watch_paths().into_iter().map(|p| dunce::canonicalize(&p).unwrap_or(p)).collect();
    for path in &watch_paths {
        if path.exists() {
            watcher.watch(path, RecursiveMode::Recursive).with_context(|| format!("watching {}", path.display()))?;
        }
    }
    // As the watcher reports paths: resolved, for an output that's a link or `../public`.
    let output = dunce::canonicalize(&ctx.output_dir).unwrap_or_else(|_| ctx.output_dir.clone());
    // The output too, for CSS and JavaScript other tools write there.
    if output.exists() && !watch_paths.iter().any(|p| output.starts_with(p)) {
        watcher.watch(&output, RecursiveMode::Recursive).with_context(|| format!("watching {}", output.display()))?;
    }
    // The configuration's own files that aren't in a watched folder (the
    // config file in the project root, the modules it imports). A build can
    // add to them (a data file's imports), so this runs after each one.
    let config_files = cfg.config_files();
    let mut watched_files: HashSet<PathBuf> = HashSet::new();
    let mut watch_config_files = |watcher: &mut notify::RecommendedWatcher| {
        let files: Vec<PathBuf> = config_files.lock().unwrap().iter().cloned().collect();
        for file in files {
            if file.starts_with(&output) || watch_paths.iter().any(|p| file.starts_with(p)) || !watched_files.insert(file.clone()) {
                continue;
            }
            // Editors often replace a file when saving, which ends a watch on
            // the file itself, so watch its folder (not what's below it).
            if let Some(dir) = file.parent() {
                let _ = watcher.watch(dir, RecursiveMode::NonRecursive);
            }
        }
    };
    watch_config_files(&mut watcher);
    // What each changed source held the last time it was seen.
    let mut contents: std::collections::HashMap<PathBuf, Option<u64>> = Default::default();
    loop {
        let mut paths = rx.recv()?;
        // Debounce bursts of events (editors often write several times), for a second at
        // most: a folder that's written to all the time mustn't hold a rebuild back forever.
        let burst = std::time::Instant::now();
        while burst.elapsed() < Duration::from_secs(1) {
            match rx.recv_timeout(Duration::from_millis(120)) {
                Ok(more) => paths.extend(more),
                Err(_) => break,
            }
        }
        // What a build writes for itself (`.cache`, in a site whose input folder is the
        // project root) isn't a change to the site: rebuilding for it would never end.
        let own = |p: &PathBuf| p.strip_prefix(&ctx.root).is_ok_and(|rel| rel.components().any(|c| matches!(c.as_os_str().to_str(), Some(".cache" | ".git" | "node_modules"))));
        let (outputs, sources): (Vec<PathBuf>, Vec<PathBuf>) = paths.into_iter().map(|p| dunce::canonicalize(&p).unwrap_or(p)).filter(|p| !own(p)).partition(|p| p.starts_with(&output));
        // A source written again with the same contents hasn't changed: a `beforeBuild`
        // command that writes into the input folder on every build would rebuild forever.
        let sources: Vec<PathBuf> = sources.into_iter().filter(|p| contents.insert(p.clone(), fingerprint(p)) != Some(fingerprint(p))).collect();
        let is_config = |p: &PathBuf| config_files.lock().unwrap().contains(p);
        // Folders watched for a config file see their other files change too.
        let in_sources = |p: &PathBuf| watch_paths.iter().any(|w| p.starts_with(w)) || is_config(p);
        let show = |p: &Path| p.strip_prefix(&ctx.root).unwrap_or(p).display().to_string();
        if let Some(p) = sources.iter().find(|p| is_config(p)) {
            println!("{} {} (reading the configuration again)", crate::voice::FRESH_TRACKS, show(p));
            if reload() {
                return Ok(Reloaded);
            }
        } else if let Some(p) = sources.iter().find(|p| in_sources(p)) {
            println!("{} {}", crate::voice::FRESH_TRACKS, show(p));
            built_at = run_build(cfg, live).0;
            watch_config_files(&mut watcher);
        } else if let Some(p) = outputs.iter().find(|p| written_by_another_tool(p, built_at)) {
            println!("{} {} (reloading)", crate::voice::FRESH_TRACKS, show(p));
            live.changed(&ctx.output_dir);
        }
    }
}

/// A hash of a file's contents, or `None` for a folder or a file that's gone.
fn fingerprint(path: &Path) -> Option<u64> {
    use std::hash::{Hash, Hasher};
    let bytes = std::fs::read(path).ok()?;
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    bytes.hash(&mut hasher);
    Some(hasher.finish())
}

/// A CSS or JavaScript file in the output that changed after the last build
/// finished, so another tool wrote it (ssqch's own copies are older).
fn written_by_another_tool(path: &Path, built_at: SystemTime) -> bool {
    let asset = path.extension().is_some_and(|e| e == "css" || e == "js" || e == "mjs");
    asset && std::fs::metadata(path).and_then(|m| m.modified()).is_ok_and(|t| t > built_at)
}

/// Build, print the summary (or the error), and tell the browsers. Returns
/// when the build finished, and whether it worked.
fn run_build(cfg: &Config, live: &Live) -> (SystemTime, bool) {
    let ok = match crate::build(cfg) {
        Ok(report) => {
            crate::cli::print_report(cfg, &report);
            live.changed(&cfg.build_context().output_dir);
            true
        }
        Err(e) => {
            // With the lines it's about, in the terminal and over the page.
            let said = crate::diagnostics::describe(&e, "build", &crate::diagnostics::Locator::of(cfg));
            eprintln!("{} {}", crate::diagnostics::red("Build failed:"), said);
            live.failed(said);
            false
        }
    };
    (SystemTime::now(), ok)
}

/// What the browsers ask about: what changed, and whether the build works.
#[derive(Default)]
struct Live(Mutex<LiveState>);

#[derive(Default)]
struct LiveState {
    /// Goes up with everything a browser should hear about.
    id: u64,
    /// The last build's error, until a build works.
    error: Option<String>,
    /// Each file in the output as it was last seen ([`stamp`]), by its path
    /// from the output folder.
    seen: HashMap<String, (u64, u64)>,
    /// The `id` at which each file last changed (or went away).
    changed_at: HashMap<String, u64>,
}

impl Live {
    /// The output may have changed: a build finished, or another tool wrote
    /// there. Look at every file, and note the ones that differ.
    fn changed(&self, output: &Path) {
        let now: HashMap<String, (u64, u64)> = walkdir::WalkDir::new(output)
            .into_iter()
            .filter_map(Result::ok)
            .filter(|e| e.file_type().is_file())
            .filter_map(|e| Some((crate::slashes(e.path().strip_prefix(output).ok()?), stamp(e.path(), &e.metadata().ok()?))))
            .collect();
        let mut state = self.0.lock().unwrap();
        state.id += 1;
        state.error = None;
        let id = state.id;
        let differs: Vec<String> = now.iter().filter(|(file, at)| state.seen.get(*file) != Some(at)).map(|(file, _)| file.clone()).chain(state.seen.keys().filter(|file| !now.contains_key(*file)).cloned()).collect();
        for file in differs {
            state.changed_at.insert(file, id);
        }
        state.seen = now;
    }

    /// A build failed: the output is as it was, and browsers show `error`.
    fn failed(&self, error: String) {
        let mut state = self.0.lock().unwrap();
        state.id += 1;
        state.error = Some(error);
    }

    /// The answer for a browser that last heard `since` and is showing the
    /// page in `page` (a file in the output): the `id` now, the build's
    /// `error`, whether to `reload`, and the stylesheets (`css`, as URLs) to
    /// fetch again. A page reloads when its own file changed, or a file that
    /// isn't a page or a stylesheet (a script, an image: any page may use it).
    fn answer(&self, since: Option<u64>, page: &str, base: &str) -> serde_json::Value {
        let state = self.0.lock().unwrap();
        let mut reload = false;
        let mut css = Vec::new();
        match since {
            // A server that started again counts from the beginning.
            Some(since) if since > state.id => reload = true,
            Some(since) => {
                let known = state.seen.contains_key(page);
                for (file, _) in state.changed_at.iter().filter(|(_, at)| **at > since) {
                    let kind = file.rsplit_once('.').map(|(_, ext)| ext).unwrap_or("");
                    if file == page {
                        reload = true;
                    } else if kind == "css" {
                        css.push(format!("{}/{}", base, file));
                    } else if matches!(kind, "html" | "htm" | "xml" | "txt" | "json" | "map" | "webmanifest") {
                        // Another page. One that isn't there yet (a 404) reloads to see if it is now.
                        reload |= !known;
                    } else {
                        reload = true;
                    }
                }
            }
            None => {}
        }
        css.sort();
        serde_json::json!({ "id": state.id, "error": state.error, "reload": reload, "css": css })
    }
}

/// What tells one version of an output file from the next: its size, and
/// when it was written. Stylesheets and scripts are told apart by their
/// contents instead, since the tools that write them (Sass, PostCSS, esbuild)
/// write them again whether or not anything changed.
fn stamp(path: &Path, meta: &std::fs::Metadata) -> (u64, u64) {
    let by_contents = path.extension().is_some_and(|e| e == "css" || e == "js" || e == "mjs");
    let mark = if by_contents { fingerprint(path) } else { meta.modified().ok().and_then(|t| t.duration_since(SystemTime::UNIX_EPOCH).ok()).map(|d| d.as_nanos() as u64) };
    (meta.len(), mark.unwrap_or(0))
}

/// One value from a query string (`v=3&p=%2Fabout%2F`), decoded.
fn query_value(query: &str, key: &str) -> Option<String> {
    query.split('&').filter_map(|pair| pair.split_once('=')).find(|(k, _)| *k == key).map(|(_, v)| percent_decode(v))
}

/// The file in the output that a page's URL path is: `about/index.html` for
/// `/about/` (under the site's `base`, when it has one).
fn page_file(path: &str, base: &str) -> String {
    let path = match mounted(path, base) {
        Mounted::Path(path) => path,
        _ => path,
    };
    let rel = path.trim_start_matches('/');
    if rel.is_empty() || rel.ends_with('/') { format!("{}index.html", rel) } else { rel.to_string() }
}

fn content_type(path: &Path) -> &'static str {
    match path.extension().and_then(|e| e.to_str()).unwrap_or("") {
        "html" => "text/html; charset=utf-8",
        "css" => "text/css; charset=utf-8",
        "js" | "mjs" => "text/javascript; charset=utf-8",
        "json" => "application/json",
        "xml" => "application/xml; charset=utf-8",
        "txt" => "text/plain; charset=utf-8",
        "svg" => "image/svg+xml",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "avif" => "image/avif",
        "ico" => "image/x-icon",
        "woff2" => "font/woff2",
        "woff" => "font/woff",
        "pdf" => "application/pdf",
        _ => "application/octet-stream",
    }
}

fn percent_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let Ok(b) = u8::from_str_radix(&s[i + 1..i + 3], 16) {
                out.push(b);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).to_string()
}

/// Where a request path is in the output folder, for a site served under
/// `base` (`/repo`): `/repo/about/` is `/about/`. Paths outside the base
/// aren't part of the site, except `/`, which sends the browser to it.
enum Mounted<'a> {
    Path(&'a str),
    Redirect(String),
    Outside,
}

fn mounted<'a>(url: &'a str, base: &str) -> Mounted<'a> {
    if base.is_empty() {
        return Mounted::Path(url);
    }
    match url.strip_prefix(base) {
        Some(rest) if rest.starts_with('/') => Mounted::Path(rest),
        Some("") => Mounted::Redirect(format!("{}/", base)),
        _ if url == "/" => Mounted::Redirect(format!("{}/", base)),
        _ => Mounted::Outside,
    }
}

/// Whether a decoded request path (without its leading `/`) can only name
/// something inside the folder it's joined to: plain names, so no `..`, no
/// second leading `/` (`/%2Fetc/hosts`), no drive letter and no backslash.
fn inside(rel: &str) -> bool {
    !rel.contains('\\') && Path::new(rel).components().all(|c| matches!(c, std::path::Component::Normal(_)))
}

fn handle(request: tiny_http::Request, root: &Path, live: &Live, base: &str) -> Result<()> {
    let (raw_url, query) = request.url().split('#').next().unwrap_or("/").split_once('?').map(|(url, query)| (url.to_string(), query.to_string())).unwrap_or_else(|| (request.url().split('#').next().unwrap_or("/").to_string(), String::new()));
    let no_cache = || tiny_http::Header::from_bytes("Cache-Control", "no-store").unwrap();
    if raw_url == "/__ssqch/build" {
        let since = query_value(&query, "v").and_then(|v| v.parse::<u64>().ok());
        let page = page_file(&query_value(&query, "p").unwrap_or_default(), base);
        let json = tiny_http::Header::from_bytes("Content-Type", "application/json").unwrap();
        return Ok(request.respond(tiny_http::Response::from_string(live.answer(since, &page, base).to_string()).with_header(json).with_header(no_cache()))?);
    }
    // A footprint for the tab of a site without an icon, and a red one while the build is broken.
    let icon = match raw_url.as_str() {
        "/favicon.ico" if !root.join("favicon.ico").is_file() => Some("#3f6b3a"),
        "/__ssqch/favicon-error.svg" => Some("#dc2626"),
        _ => None,
    };
    if let Some(fill) = icon {
        let svg = tiny_http::Header::from_bytes("Content-Type", "image/svg+xml").unwrap();
        return Ok(request.respond(tiny_http::Response::from_string(FOOTPRINT_ICON.replace("{fill}", fill)).with_header(svg).with_header(no_cache()))?);
    }
    // Decoded once, before anything looks at the path.
    let full_url = percent_decode(&raw_url);
    let url = match mounted(&full_url, base) {
        Mounted::Path(path) => path.to_string(),
        Mounted::Redirect(to) => {
            let location = tiny_http::Header::from_bytes("Location", to).unwrap();
            return Ok(request.respond(tiny_http::Response::empty(302).with_header(location))?);
        }
        Mounted::Outside => {
            let body = format!("Wrong trailhead: this site is served under {}/ (its `base`).", base);
            return Ok(request.respond(tiny_http::Response::from_string(body).with_status_code(404))?);
        }
    };
    let rel = url.trim_start_matches('/');
    if !inside(rel) {
        return Ok(request.respond(tiny_http::Response::empty(400))?);
    }
    let mut path = root.join(rel);
    if path.is_dir() {
        if !url.ends_with('/') {
            let location = tiny_http::Header::from_bytes("Location", format!("{}/", raw_url)).unwrap();
            return Ok(request.respond(tiny_http::Response::empty(301).with_header(location))?);
        }
        path = path.join("index.html");
    }
    let (status, path) = if path.is_file() { (200, path) } else { (404, root.join("404.html")) };
    let (mut body, ctype) = match std::fs::read(&path) {
        Ok(body) => (body, content_type(&path)),
        Err(_) => (not_found_page(root, &url, base).into_bytes(), "text/html; charset=utf-8"),
    };
    if ctype.starts_with("text/html") {
        let html = String::from_utf8_lossy(&body);
        body = match html.rfind("</body>") {
            Some(i) => format!("{}<script>{}</script>{}", &html[..i], LIVE_SCRIPT, &html[i..]),
            None => format!("{}<script>{}</script>", html, LIVE_SCRIPT),
        }
        .into_bytes();
    }
    let header = tiny_http::Header::from_bytes("Content-Type", ctype).unwrap();
    // The dev server's own; a deployed site's headers are its host's.
    let powered_by = tiny_http::Header::from_bytes("X-Powered-By", "pine cones").unwrap();
    request.respond(tiny_http::Response::from_data(body).with_status_code(status).with_header(header).with_header(no_cache()).with_header(powered_by))?;
    Ok(())
}

/// Every page in the output folder, by URL: `/about/` for `about/index.html`.
fn page_urls(root: &Path) -> Vec<String> {
    walkdir::WalkDir::new(root)
        .into_iter()
        .filter_map(Result::ok)
        .filter(|e| e.file_type().is_file() && e.path().extension().is_some_and(|ext| ext == "html"))
        .filter_map(|e| e.path().strip_prefix(root).ok().map(crate::slashes))
        .map(|rel| match rel.strip_suffix("index.html") {
            Some(dir) => format!("/{}", dir),
            None => format!("/{}", rel),
        })
        .collect()
}

/// [`NOT_FOUND_PAGE`] for `url`, with the page whose URL is closest to it,
/// if one is close.
fn not_found_page(root: &Path, url: &str, base: &str) -> String {
    let urls = page_urls(root);
    let suggestion = match crate::suggest::closest_path(url, urls.iter().map(String::as_str)) {
        Some(found) => format!("<p>Did you mean <a href=\"{0}{1}\">{1}</a>?</p>", crate::escape_html(base), crate::escape_html(found)),
        None => String::new(),
    };
    NOT_FOUND_PAGE.replace("{{url}}", &crate::escape_html(url)).replace("{{suggestion}}", &suggestion).replace("{{home}}", &format!("{}/", crate::escape_html(base)))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn request_paths_stay_inside_the_output() {
        for ok in ["", "about/", "posts/pine/index.html", "my file.pdf", "a..b/c"] {
            assert!(inside(ok), "{:?}", ok);
        }
        // `/%2Fetc/hosts` decodes to a second leading slash, which would replace the folder.
        for bad in ["/etc/hosts", "../secret", "a/../../b", "./x", "..\\..\\x", "C:\\Windows"] {
            assert!(!inside(bad), "{:?}", bad);
        }
        assert_eq!(percent_decode("/%2Fetc/hosts").trim_start_matches('/'), "etc/hosts");
    }

    #[test]
    fn browsers_hear_what_changed() {
        let dir = std::env::temp_dir().join(format!("ssqch-serve-live-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let write = |rel: &str, text: &str| {
            std::fs::create_dir_all(dir.join(rel).parent().unwrap()).unwrap();
            std::fs::write(dir.join(rel), text).unwrap();
        };
        write("index.html", "home");
        write("about/index.html", "about");
        write("assets/index.css", "body{}");
        write("assets/index.js", "1");
        write("feed.xml", "<feed/>");
        let live = Live::default();
        live.changed(&dir);
        let answer = |since: Option<u64>, page: &str| live.answer(since, page, "/repo").to_string();
        // A browser that has just arrived only learns where things stand.
        assert_eq!(answer(None, "index.html"), r#"{"id":1,"error":null,"reload":false,"css":[]}"#);
        assert_eq!(answer(Some(1), "index.html"), r#"{"id":1,"error":null,"reload":false,"css":[]}"#);

        // Another page (and the feed) changed: this one stays. Its own page reloads.
        write("about/index.html", "about us");
        write("feed.xml", "<feed>more</feed>");
        live.changed(&dir);
        assert_eq!(answer(Some(1), "index.html"), r#"{"id":2,"error":null,"reload":false,"css":[]}"#);
        assert_eq!(answer(Some(1), "about/index.html"), r#"{"id":2,"error":null,"reload":true,"css":[]}"#);
        // A page that isn't there yet reloads, in case it is now.
        assert_eq!(answer(Some(1), "contact/index.html"), r#"{"id":2,"error":null,"reload":true,"css":[]}"#);

        // A stylesheet is swapped, under the site's base; a script reloads.
        write("assets/index.css", "body{color:red}");
        live.changed(&dir);
        assert_eq!(answer(Some(2), "index.html"), r#"{"id":3,"error":null,"reload":false,"css":["/repo/assets/index.css"]}"#);
        // A browser that missed a build hears about both.
        assert_eq!(answer(Some(1), "about/index.html"), r#"{"id":3,"error":null,"reload":true,"css":["/repo/assets/index.css"]}"#);
        write("assets/index.js", "22");
        live.changed(&dir);
        assert_eq!(answer(Some(3), "index.html"), r#"{"id":4,"error":null,"reload":true,"css":[]}"#);

        // A failed build changes nothing but says so, until one works.
        live.failed("in index.md: nope".into());
        assert_eq!(answer(Some(4), "index.html"), r#"{"id":5,"error":"in index.md: nope","reload":false,"css":[]}"#);
        live.changed(&dir);
        assert_eq!(answer(Some(5), "index.html"), r#"{"id":6,"error":null,"reload":false,"css":[]}"#);
        // A page that went away, and a server that started again.
        std::fs::remove_file(dir.join("about/index.html")).unwrap();
        live.changed(&dir);
        assert_eq!(answer(Some(6), "about/index.html"), r#"{"id":7,"error":null,"reload":true,"css":[]}"#);
        assert_eq!(answer(Some(40), "index.html"), r#"{"id":7,"error":null,"reload":true,"css":[]}"#);

        assert_eq!(page_file("/repo/about/", "/repo"), "about/index.html");
        assert_eq!(page_file("/", ""), "index.html");
        assert_eq!(page_file("/notes.html", ""), "notes.html");
        assert_eq!(query_value("v=3&p=%2Fabout%2F", "p").as_deref(), Some("/about/"));
        assert_eq!(query_value("v=&p=%2F", "v").as_deref(), Some(""));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_missing_page_names_the_closest_one() {
        let dir = std::env::temp_dir().join(format!("ssqch-serve-404-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join("contact")).unwrap();
        std::fs::write(dir.join("contact/index.html"), "<p>Hi</p>").unwrap();
        std::fs::write(dir.join("index.html"), "<p>Home</p>").unwrap();
        std::fs::write(dir.join("feed.xml"), "<feed/>").unwrap();
        let mut urls = page_urls(&dir);
        urls.sort();
        assert_eq!(urls, ["/", "/contact/"]);

        let page = not_found_page(&dir, "/contactt/", "/repo");
        assert!(page.contains("The trail goes cold at <code>/contactt/</code>"), "{}", page);
        assert!(page.contains("Did you mean <a href=\"/repo/contact/\">/contact/</a>?"), "{}", page);
        assert!(page.contains("<a href=\"/repo/\">Back to the trailhead</a>"), "{}", page);
        // Nothing close: no guess. And the URL is escaped.
        let page = not_found_page(&dir, "/<script>alert(1)</script>/", "");
        assert!(!page.contains("Did you mean"), "{}", page);
        assert!(!page.contains("<script>alert"), "{}", page);
        assert!(page.contains("<a href=\"/\">Back to the trailhead</a>"), "{}", page);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_base_mounts_the_site_under_its_path() {
        let path = |url, base| match mounted(url, base) {
            Mounted::Path(p) => format!("path {}", p),
            Mounted::Redirect(to) => format!("redirect {}", to),
            Mounted::Outside => "outside".to_string(),
        };
        assert_eq!(path("/about/", ""), "path /about/");
        assert_eq!(path("/repo/about/", "/repo"), "path /about/");
        assert_eq!(path("/repo/", "/repo"), "path /");
        assert_eq!(path("/repo", "/repo"), "redirect /repo/");
        assert_eq!(path("/", "/repo"), "redirect /repo/");
        assert_eq!(path("/about/", "/repo"), "outside");
        assert_eq!(path("/repository/", "/repo"), "outside");
    }
}
