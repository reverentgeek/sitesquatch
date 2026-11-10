//! Development server: static file server, file watcher and live reload.
//!
//! A change to the site's sources rebuilds it and reloads the browser. A CSS
//! or JavaScript file that another tool writes into the output folder (a
//! PostCSS or esbuild watcher, say) reloads the browser without a rebuild,
//! so a page never reloads before its new CSS is there.

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{mpsc, Arc};
use std::time::{Duration, SystemTime};

use anyhow::{Context, Result};
use notify::{RecursiveMode, Watcher};

use crate::config::Config;

const RELOAD_SCRIPT: &str = r#"<script>(()=>{let v;setInterval(async()=>{try{const t=await (await fetch('/__ssqch/build')).text();if(v&&t!==v)location.reload();v=t}catch{}},700)})();</script>"#;

pub fn serve(cfg: &Config, port: u16) -> Result<()> {
    let ctx = cfg.build_context();
    let build_id = Arc::new(AtomicU64::new(0));
    let mut built_at = run_build(cfg, &build_id);

    let server = tiny_http::Server::http(("127.0.0.1", port)).map_err(|e| anyhow::anyhow!("can't listen on port {}: {}", port, e))?;
    println!("Serving {} at http://localhost:{}/", ctx.output_dir.display(), port);
    let out_dir = ctx.output_dir.clone();
    let id = build_id.clone();
    std::thread::spawn(move || {
        for request in server.incoming_requests() {
            let _ = handle(request, &out_dir, &id);
        }
    });

    let (tx, rx) = mpsc::channel();
    let mut watcher = notify::recommended_watcher(move |res: notify::Result<notify::Event>| {
        if let Ok(event) = res {
            let _ = tx.send(event.paths);
        }
    })?;
    for path in cfg.watch_paths() {
        if path.exists() {
            watcher.watch(&path, RecursiveMode::Recursive).with_context(|| format!("watching {}", path.display()))?;
        }
    }
    // As the watcher reports paths: resolved, for an output that's a link or `../public`.
    let output = dunce::canonicalize(&ctx.output_dir).unwrap_or_else(|_| ctx.output_dir.clone());
    // The output too, for CSS and JavaScript other tools write there.
    if output.exists() && !cfg.watch_paths().iter().any(|p| output.starts_with(p)) {
        watcher.watch(&output, RecursiveMode::Recursive).with_context(|| format!("watching {}", output.display()))?;
    }
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
        // A source written again with the same contents hasn't changed: a hook that writes
        // into the input folder on every build would rebuild forever.
        let sources: Vec<PathBuf> = sources.into_iter().filter(|p| contents.insert(p.clone(), fingerprint(p)) != Some(fingerprint(p))).collect();
        if let Some(p) = sources.first() {
            println!("Changed: {}", p.strip_prefix(&ctx.root).unwrap_or(p).display());
            built_at = run_build(cfg, &build_id);
        } else if let Some(p) = outputs.iter().find(|p| written_by_another_tool(p, built_at)) {
            println!("Changed: {} (reloading)", p.strip_prefix(&ctx.root).unwrap_or(p).display());
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

/// Whether a decoded request path (without its leading `/`) can only name
/// something inside the folder it's joined to: plain names, so no `..`, no
/// second leading `/` (`/%2Fetc/hosts`), no drive letter and no backslash.
fn inside(rel: &str) -> bool {
    !rel.contains('\\') && Path::new(rel).components().all(|c| matches!(c, std::path::Component::Normal(_)))
}

fn handle(request: tiny_http::Request, root: &Path, build_id: &AtomicU64) -> Result<()> {
    let raw_url = request.url().split(['?', '#']).next().unwrap_or("/").to_string();
    if raw_url == "/__ssqch/build" {
        return Ok(request.respond(tiny_http::Response::from_string(build_id.load(Ordering::SeqCst).to_string()))?);
    }
    // Decoded once, before anything looks at the path.
    let url = percent_decode(&raw_url);
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
}
