//! Development server: static file server, file watcher and live reload.

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{mpsc, Arc};
use std::time::Duration;

use anyhow::{Context, Result};
use notify::{RecursiveMode, Watcher};

use crate::config::Config;

const RELOAD_SCRIPT: &str = r#"<script>(()=>{let v;setInterval(async()=>{try{const t=await (await fetch('/__ssqch/build')).text();if(v&&t!==v)location.reload();v=t}catch{}},700)})();</script>"#;

pub fn serve(cfg: &Config, port: u16) -> Result<()> {
    let ctx = cfg.build_context();
    let build_id = Arc::new(AtomicU64::new(0));
    run_build(cfg, &build_id);

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
    let output = ctx.output_dir.clone();
    loop {
        let paths = rx.recv()?;
        let mut relevant: Vec<PathBuf> = paths.into_iter().filter(|p| !p.starts_with(&output)).collect();
        // Debounce bursts of events (editors often write several times).
        while let Ok(more) = rx.recv_timeout(Duration::from_millis(120)) {
            relevant.extend(more.into_iter().filter(|p| !p.starts_with(&output)));
        }
        if relevant.is_empty() {
            continue;
        }
        if let Some(p) = relevant.first() {
            println!("Changed: {}", p.strip_prefix(&ctx.root).unwrap_or(p).display());
        }
        run_build(cfg, &build_id);
    }
}

fn run_build(cfg: &Config, build_id: &AtomicU64) {
    match crate::build(cfg) {
        Ok(report) => {
            crate::cli::print_report(cfg, &report);
            build_id.fetch_add(1, Ordering::SeqCst);
        }
        Err(e) => eprintln!("\x1b[31mBuild failed:\x1b[0m {:#}", e),
    }
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

fn handle(request: tiny_http::Request, root: &Path, build_id: &AtomicU64) -> Result<()> {
    let url = request.url().split(['?', '#']).next().unwrap_or("/").to_string();
    if url == "/__ssqch/build" {
        return Ok(request.respond(tiny_http::Response::from_string(build_id.load(Ordering::SeqCst).to_string()))?);
    }
    let rel = percent_decode(url.trim_start_matches('/'));
    if rel.split('/').any(|seg| seg == "..") {
        return Ok(request.respond(tiny_http::Response::empty(400))?);
    }
    let mut path = root.join(&rel);
    if path.is_dir() {
        if !url.ends_with('/') {
            let location = tiny_http::Header::from_bytes("Location", format!("{}/", url)).unwrap();
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
