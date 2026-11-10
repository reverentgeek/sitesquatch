//! Development server: static file server, file watcher and live reload.
//!
//! A change to the site's sources rebuilds it and reloads the browser. A CSS
//! or JavaScript file that another tool writes into the output folder (a
//! PostCSS or esbuild watcher, say) reloads the browser without a rebuild,
//! so a page never reloads before its new CSS is there.

use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{mpsc, Arc, RwLock};
use std::time::{Duration, SystemTime};

use anyhow::{Context, Result};
use notify::{RecursiveMode, Watcher};

use crate::config::Config;

const RELOAD_SCRIPT: &str = r#"<script>(()=>{let v;setInterval(async()=>{try{const t=await (await fetch('/__ssqch/build')).text();if(v&&t!==v)location.reload();v=t}catch{}},700)})();</script>"#;

/// Serve the site as `cfg` describes it. Changes to its configuration need a
/// restart; [`serve_reloading`] picks those up too.
pub fn serve(cfg: &Config, port: u16) -> Result<()> {
    let build_id = Arc::new(AtomicU64::new(0));
    let site = Arc::new(RwLock::new(Site::of(cfg)));
    let server = listen(port, &site, &build_id)?;
    println!("Serving {} at http://localhost:{}{}/", site.read().unwrap().output.display(), server, site.read().unwrap().base);
    watch(cfg, &build_id, &|| {
        println!("Restart to use the changed configuration.");
        false
    })
    .map(|_| ())
}

/// [`serve`], reading the configuration again (with `reload`) when one of
/// the files it came from changes ([`Config::add_config_file`]). If the new
/// configuration doesn't load, the error is printed and the last good one
/// keeps serving.
pub fn serve_reloading(first: Config, port: u16, reload: &dyn Fn() -> Result<Config>) -> Result<()> {
    let build_id = Arc::new(AtomicU64::new(0));
    let site = Arc::new(RwLock::new(Site::of(&first)));
    let server = listen(port, &site, &build_id)?;
    println!("Serving {} at http://localhost:{}{}/", site.read().unwrap().output.display(), server, site.read().unwrap().base);
    let mut cfg = first;
    loop {
        *site.write().unwrap() = Site::of(&cfg);
        let next: std::cell::RefCell<Option<Config>> = Default::default();
        // Returns once a changed configuration has loaded.
        let Reloaded = watch(&cfg, &build_id, &|| match reload() {
            Ok(new) => {
                *next.borrow_mut() = Some(new);
                true
            }
            Err(e) => {
                eprintln!("\x1b[31mConfig error:\x1b[0m {:#}\n(still serving with the last configuration that loaded)", e);
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
fn listen(port: u16, site: &Arc<RwLock<Site>>, build_id: &Arc<AtomicU64>) -> Result<u16> {
    let server = tiny_http::Server::http(("127.0.0.1", port)).map_err(|e| anyhow::anyhow!("can't listen on port {}: {}", port, e))?;
    let port = server.server_addr().to_ip().map(|a| a.port()).unwrap_or(port);
    let (site, id) = (site.clone(), build_id.clone());
    std::thread::spawn(move || {
        for request in server.incoming_requests() {
            let (output, base) = {
                let site = site.read().unwrap();
                (site.output.clone(), site.base.clone())
            };
            let _ = handle(request, &output, &id, &base);
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
fn watch(cfg: &Config, build_id: &AtomicU64, reload: &dyn Fn() -> bool) -> Result<Reloaded> {
    let ctx = cfg.build_context();
    let mut built_at = run_build(cfg, build_id);

    let (tx, rx) = mpsc::channel();
    let mut watcher = notify::recommended_watcher(move |res: notify::Result<notify::Event>| {
        if let Ok(event) = res {
            let _ = tx.send(event.paths);
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
        // Debounce bursts of events (editors often write several times).
        while let Ok(more) = rx.recv_timeout(Duration::from_millis(120)) {
            paths.extend(more);
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
            println!("Changed: {} (reading the configuration again)", show(p));
            if reload() {
                return Ok(Reloaded);
            }
        } else if let Some(p) = sources.iter().find(|p| in_sources(p)) {
            println!("Changed: {}", show(p));
            built_at = run_build(cfg, build_id);
            watch_config_files(&mut watcher);
        } else if let Some(p) = outputs.iter().find(|p| written_by_another_tool(p, built_at)) {
            println!("Changed: {} (reloading)", show(p));
            build_id.fetch_add(1, Ordering::SeqCst);
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

/// Build, print the summary, and bump the build id the browser polls.
/// Returns when the build finished.
fn run_build(cfg: &Config, build_id: &AtomicU64) -> SystemTime {
    match crate::build(cfg) {
        Ok(report) => {
            crate::cli::print_report(cfg, &report);
            build_id.fetch_add(1, Ordering::SeqCst);
        }
        Err(e) => eprintln!("\x1b[31mBuild failed:\x1b[0m {:#}", e),
    }
    SystemTime::now()
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

fn handle(request: tiny_http::Request, root: &Path, build_id: &AtomicU64, base: &str) -> Result<()> {
    let raw_url = request.url().split(['?', '#']).next().unwrap_or("/").to_string();
    if raw_url == "/__ssqch/build" {
        return Ok(request.respond(tiny_http::Response::from_string(build_id.load(Ordering::SeqCst).to_string()))?);
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
            let body = format!("Not found: this site is served under {}/ (its `base`).", base);
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
    let mut body = std::fs::read(&path).unwrap_or_else(|_| b"Not found".to_vec());
    let ctype = if path.is_file() { content_type(&path) } else { "text/plain" };
    if ctype.starts_with("text/html") {
        let html = String::from_utf8_lossy(&body);
        body = match html.rfind("</body>") {
            Some(i) => format!("{}{}{}", &html[..i], RELOAD_SCRIPT, &html[i..]),
            None => format!("{}{}", html, RELOAD_SCRIPT),
        }
        .into_bytes();
    }
    let header = tiny_http::Header::from_bytes("Content-Type", ctype).unwrap();
    let no_cache = tiny_http::Header::from_bytes("Cache-Control", "no-store").unwrap();
    request.respond(tiny_http::Response::from_data(body).with_status_code(status).with_header(header).with_header(no_cache))?;
    Ok(())
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
