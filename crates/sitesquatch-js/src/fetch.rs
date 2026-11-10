//! The natives behind `fetch()` in `node.js`. Each request runs on a thread
//! of its own (at most [`MAX_RUNNING`] at once), so `Promise.all` over many
//! URLs fetches them in parallel. JavaScript picks up finished requests in
//! `__ssqch.wait`, when it has nothing else to run.
//!
//! `fetch(url, { cache: "1h" })` saves a successful response under
//! `.cache/ssqch/fetch/` and reuses it until it's that old, so rebuilds don't
//! ask the network every time. When a refresh fails and an older copy is
//! there, the build uses it and warns. With `SSQCH_OFFLINE` set (`--offline`),
//! saved copies are used whatever their age, and nothing is requested.

use std::collections::VecDeque;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Condvar, Mutex};
use std::time::Duration;
#[cfg(feature = "fetch")]
use std::time::{SystemTime, UNIX_EPOCH};

use rquickjs::prelude::Opt;
use rquickjs::{Ctx, Exception, Function, Object, Result, TypedArray, Value};

/// Requests in flight at once; more wait for a turn.
#[cfg(feature = "fetch")]
const MAX_RUNNING: usize = 8;

/// A finished request: the response, or why there isn't one.
type Outcome = std::result::Result<Reply, String>;

#[derive(Clone)]
#[cfg_attr(not(feature = "fetch"), allow(dead_code))]
struct Reply {
    status: u16,
    status_text: String,
    url: String,
    redirected: bool,
    headers: Vec<(String, String)>,
    body: Vec<u8>,
}

#[derive(Default)]
#[cfg_attr(not(feature = "fetch"), allow(dead_code))]
struct State {
    next_id: u32,
    done: VecDeque<(u32, Outcome)>,
    running: usize,
}

#[derive(Default)]
struct Fetches {
    state: Mutex<State>,
    /// Signalled when a request finishes or frees a slot.
    changed: Condvar,
    /// Where saved responses go: `.cache/ssqch/fetch` in the project.
    #[cfg_attr(not(feature = "fetch"), allow(dead_code))]
    dir: PathBuf,
}

/// What a request asks for.
#[cfg_attr(not(feature = "fetch"), allow(dead_code))]
struct Ask {
    url: String,
    method: String,
    headers: Vec<(String, String)>,
    body: Option<Vec<u8>>,
    /// `"follow"`, `"manual"` or `"error"`.
    redirect: String,
    timeout: Option<Duration>,
    cache: Cache,
}

/// A request's `cache` option.
#[derive(Clone, Copy, Debug, PartialEq)]
#[cfg_attr(not(feature = "fetch"), allow(dead_code))]
enum Cache {
    /// Always ask the network, and save nothing (the default).
    Off,
    /// Use a saved copy younger than this; otherwise ask, and save the answer.
    MaxAge(Duration),
    /// `"force-cache"`: use a saved copy of any age; ask only without one.
    Forever,
    /// `"reload"`: ask, and save the answer.
    Reload,
    /// `"only-if-cached"`: use a saved copy of any age, or fail.
    Only,
}

impl Cache {
    fn parse(mode: &str, seconds: f64) -> std::result::Result<Cache, String> {
        Ok(match mode {
            "" | "default" | "no-store" | "no-cache" => Cache::Off,
            "max-age" => Cache::MaxAge(duration(seconds)),
            "force-cache" => Cache::Forever,
            "reload" => Cache::Reload,
            "only-if-cached" => Cache::Only,
            other => return Err(format!("fetch: cache {:?} isn't supported (use a duration like \"1h\", or \"force-cache\", \"reload\", \"only-if-cached\" or \"no-store\")", other)),
        })
    }
}

/// `seconds` as a duration, whatever JavaScript passed: `Infinity` (or anything too
/// big) is a hundred years, and a negative number or `NaN` is none.
fn duration(seconds: f64) -> Duration {
    const LONGEST: Duration = Duration::from_secs(100 * 365 * 86_400);
    Duration::try_from_secs_f64(seconds.max(0.0)).unwrap_or(LONGEST).min(LONGEST)
}

/// How requests were answered since the last [`take_counts`]: (asked the
/// network, fresh from the cache, stale from the cache after a failure).
static COUNTS: [AtomicUsize; 3] = [AtomicUsize::new(0), AtomicUsize::new(0), AtomicUsize::new(0)];

/// The counts since the last call, for the build summary.
pub(crate) fn take_counts() -> (usize, usize, usize) {
    (COUNTS[0].swap(0, Ordering::Relaxed), COUNTS[1].swap(0, Ordering::Relaxed), COUNTS[2].swap(0, Ordering::Relaxed))
}

#[cfg(feature = "fetch")]
fn offline() -> bool {
    std::env::var("SSQCH_OFFLINE").is_ok_and(|v| !matches!(v.as_str(), "" | "0" | "false"))
}

pub(crate) fn install<'js>(ctx: &Ctx<'js>, native: &Object<'js>, root: &Path) -> Result<()> {
    let fetches = Arc::new(Fetches { dir: root.join(".cache/ssqch/fetch"), ..Default::default() });
    let f = fetches.clone();
    native.set(
        "fetchStart",
        Function::new(ctx.clone(), move |ctx: Ctx<'js>, url: String, method: String, headers: Vec<Vec<String>>, body: Opt<Value<'js>>, options: String, timeout_ms: f64| -> Result<u32> {
            // `redirect`, then the cache mode and its seconds, one per line.
            let mut options = options.split('\n');
            let redirect = options.next().unwrap_or("follow").to_string();
            let cache = Cache::parse(options.next().unwrap_or(""), options.next().and_then(|s| s.parse().ok()).unwrap_or(0.0)).map_err(|m| Exception::throw_type(&ctx, &m))?;
            let body = match body.0 {
                Some(v) if !v.is_null() && !v.is_undefined() => Some(crate::native::copy_bytes(&TypedArray::<u8>::from_value(v)?)),
                _ => None,
            };
            let headers = headers.into_iter().filter_map(|pair| match <[String; 2]>::try_from(pair) {
                Ok([k, v]) => Some((k, v)),
                Err(_) => None,
            });
            let ask = Ask { url, method, headers: headers.collect(), body, redirect, timeout: (timeout_ms > 0.0).then(|| duration(timeout_ms / 1000.0).min(Duration::from_secs(86_400))), cache };
            start(&f, ask).map_err(|m| Exception::throw_type(&ctx, &m))
        })?,
    )?;
    let f = fetches;
    native.set(
        "fetchWait",
        Function::new(ctx.clone(), move |ctx: Ctx<'js>, timeout_ms: f64| -> Result<Value<'js>> {
            let Some((id, outcome)) = wait(&f, timeout_ms) else {
                return Ok(Value::new_null(ctx));
            };
            let out = Object::new(ctx.clone())?;
            out.set("id", id)?;
            match outcome {
                Ok(reply) => {
                    out.set("status", reply.status)?;
                    out.set("statusText", reply.status_text)?;
                    out.set("url", reply.url)?;
                    out.set("redirected", reply.redirected)?;
                    out.set("headers", reply.headers.into_iter().map(|(k, v)| vec![k, v]).collect::<Vec<_>>())?;
                    out.set("body", TypedArray::<u8>::new(ctx, reply.body)?)?;
                }
                Err(message) => out.set("error", message)?,
            }
            Ok(out.into_value())
        })?,
    )?;
    Ok(())
}

/// The next finished request, waiting up to `timeout_ms` for one
/// (indefinitely if it's negative). `None` if none finished in time.
fn wait(f: &Fetches, timeout_ms: f64) -> Option<(u32, Outcome)> {
    let mut state = f.state.lock().unwrap();
    // No deadline for a negative wait, or one too long to add to the clock.
    let deadline = if timeout_ms >= 0.0 { std::time::Instant::now().checked_add(duration(timeout_ms / 1000.0)) } else { None };
    loop {
        if let Some(done) = state.done.pop_front() {
            return Some(done);
        }
        match deadline {
            None => state = f.changed.wait(state).unwrap(),
            Some(deadline) => {
                let left = deadline.saturating_duration_since(std::time::Instant::now());
                if left.is_zero() {
                    return None;
                }
                state = f.changed.wait_timeout(state, left).unwrap().0;
            }
        }
    }
}

#[cfg(not(feature = "fetch"))]
fn start(_f: &Arc<Fetches>, _ask: Ask) -> std::result::Result<u32, String> {
    Err("fetch failed: this ssqch was built without fetch (the \"fetch\" feature)".into())
}

#[cfg(feature = "fetch")]
fn start(f: &Arc<Fetches>, ask: Ask) -> std::result::Result<u32, String> {
    let id = {
        let mut state = f.state.lock().unwrap();
        state.next_id += 1;
        state.next_id
    };
    let f = f.clone();
    std::thread::Builder::new()
        .name("ssqch-fetch".into())
        .spawn(move || {
            {
                let mut state = f.state.lock().unwrap();
                while state.running >= MAX_RUNNING {
                    state = f.changed.wait(state).unwrap();
                }
                state.running += 1;
            }
            let outcome = answer(&f.dir, &ask);
            let mut state = f.state.lock().unwrap();
            state.running -= 1;
            state.done.push_back((id, outcome));
            f.changed.notify_all();
        })
        .map_err(|e| format!("fetch failed: {}", e))?;
    Ok(id)
}

/// The files a request's saved response is in: `<key>.json` (the status,
/// headers and when it was saved) and `<key>.body`. The key covers the method,
/// URL, request headers and body, so a different query or token is a
/// different entry. Neither the URL nor the request headers are written
/// anywhere: an API key is often in one of them, and CI caches keep this folder.
#[cfg(feature = "fetch")]
fn cache_paths(dir: &Path, ask: &Ask) -> (PathBuf, PathBuf) {
    use sha2::Digest;
    let mut hasher = sha2::Sha256::new();
    hasher.update(ask.method.to_ascii_uppercase().as_bytes());
    hasher.update(b"\n");
    hasher.update(ask.url.as_bytes());
    let mut headers: Vec<String> = ask.headers.iter().map(|(k, v)| format!("{}:{}", k.to_ascii_lowercase(), v)).collect();
    headers.sort();
    for h in headers {
        hasher.update(b"\n");
        hasher.update(h.as_bytes());
    }
    hasher.update(b"\n\n");
    hasher.update(ask.body.as_deref().unwrap_or_default());
    let key: String = hasher.finalize().iter().take(16).map(|b| format!("{:02x}", b)).collect();
    (dir.join(format!("{}.json", key)), dir.join(format!("{}.body", key)))
}

/// A saved response and how old it is.
#[cfg(feature = "fetch")]
fn saved(dir: &Path, ask: &Ask) -> Option<(Reply, Duration)> {
    let (meta_path, body_path) = cache_paths(dir, ask);
    let meta: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(meta_path).ok()?).ok()?;
    let body = std::fs::read(body_path).ok()?;
    let saved_at = UNIX_EPOCH + Duration::from_secs(meta["savedAt"].as_u64()?);
    let headers = meta["headers"].as_array()?.iter().filter_map(|pair| Some((pair[0].as_str()?.to_string(), pair[1].as_str()?.to_string()))).collect();
    let reply = Reply {
        status: meta["status"].as_u64()? as u16,
        status_text: meta["statusText"].as_str().unwrap_or_default().to_string(),
        // The response's own URL isn't saved (see `save`); the request's stands in for it.
        url: ask.url.clone(),
        redirected: meta["redirected"].as_bool().unwrap_or(false),
        headers,
        body,
    };
    Some((reply, SystemTime::now().duration_since(saved_at).unwrap_or_default()))
}

#[cfg(feature = "fetch")]
fn save(dir: &Path, ask: &Ask, reply: &Reply) -> std::io::Result<()> {
    let (meta_path, body_path) = cache_paths(dir, ask);
    std::fs::create_dir_all(dir)?;
    // Cookies aren't for keeping.
    let headers: Vec<[&str; 2]> = reply.headers.iter().filter(|(k, _)| !k.eq_ignore_ascii_case("set-cookie")).map(|(k, v)| [k.as_str(), v.as_str()]).collect();
    let meta = serde_json::json!({
        "method": ask.method,
        "status": reply.status,
        "statusText": reply.status_text,
        "redirected": reply.redirected,
        "headers": headers,
        "savedAt": SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_secs(),
    });
    // Each file is written beside its place and moved in, so a request for the same
    // thing at the same moment never reads (or leaves) half a file.
    static WRITES: AtomicUsize = AtomicUsize::new(0);
    let put = |path: &Path, bytes: &[u8]| -> std::io::Result<()> {
        let temp = path.with_extension(format!("{}-{}.tmp", std::process::id(), WRITES.fetch_add(1, Ordering::Relaxed)));
        std::fs::write(&temp, bytes)?;
        std::fs::rename(&temp, path).inspect_err(|_| {
            let _ = std::fs::remove_file(&temp);
        })
    };
    put(&body_path, &reply.body)?;
    put(&meta_path, serde_json::to_string_pretty(&meta).unwrap_or_default().as_bytes())
}

#[cfg(feature = "fetch")]
fn from_cache(mut reply: Reply, how: &str) -> Reply {
    reply.headers.retain(|(k, _)| !k.eq_ignore_ascii_case("x-ssqch-cache"));
    reply.headers.push(("x-ssqch-cache".into(), how.into()));
    reply
}

#[cfg(feature = "fetch")]
fn age(d: Duration) -> String {
    let s = d.as_secs();
    let (n, unit) = match s {
        0..=119 => (s, "second"),
        120..=7199 => (s / 60, "minute"),
        7200..=172_799 => (s / 3600, "hour"),
        _ => (s / 86_400, "day"),
    };
    format!("{} {}{} ago", n, unit, if n == 1 { "" } else { "s" })
}

/// Answer a request from the cache or the network, as its `cache` option says.
#[cfg(feature = "fetch")]
fn answer(dir: &Path, ask: &Ask) -> Outcome {
    let offline = offline();
    if ask.cache == Cache::Off && !offline {
        COUNTS[0].fetch_add(1, Ordering::Relaxed);
        return request(ask);
    }
    let copy = if ask.cache == Cache::Off { None } else { saved(dir, ask) };
    let fresh = |old: Duration| match ask.cache {
        Cache::MaxAge(max) => old <= max,
        Cache::Forever | Cache::Only => true,
        Cache::Off | Cache::Reload => false,
    };
    match &copy {
        Some((reply, old)) if offline || fresh(*old) => {
            COUNTS[1].fetch_add(1, Ordering::Relaxed);
            return Ok(from_cache(reply.clone(), "hit"));
        }
        None if offline && ask.cache == Cache::Off => return Err(format!("fetch failed: {}: offline (SSQCH_OFFLINE), and this request has no `cache` option, so there's no saved copy to use", ask.url)),
        None if offline => return Err(format!("fetch failed: {}: offline (SSQCH_OFFLINE), and there's no saved copy in {}", ask.url, dir.display())),
        None if ask.cache == Cache::Only => return Err(format!("fetch failed: {}: no saved copy (cache: \"only-if-cached\")", ask.url)),
        _ => {}
    }
    COUNTS[0].fetch_add(1, Ordering::Relaxed);
    let outcome = request(ask);
    let failed = match &outcome {
        // 5xx, or 429 (asked too often): the server's trouble, not the request's.
        Ok(reply) if reply.status < 500 && reply.status != 429 => None,
        Ok(reply) => Some(format!("answered {}", reply.status)),
        Err(e) => Some(e.trim_start_matches("fetch failed: ").to_string()),
    };
    match (failed, copy) {
        // An older copy is better than no build.
        (Some(why), Some((reply, old))) => {
            sitesquatch::diagnostics::warn(sitesquatch::diagnostics::Diagnostic::warning("fetch", format!("fetch: {} {}; using the copy saved {}", ask.url, why.trim_start_matches(&format!("{}: ", ask.url)), age(old))));
            COUNTS[2].fetch_add(1, Ordering::Relaxed);
            Ok(from_cache(reply, "stale"))
        }
        (None, _) => {
            if let Ok(reply) = &outcome {
                if (200..300).contains(&reply.status) {
                    if let Err(e) = save(dir, ask, reply) {
                        sitesquatch::diagnostics::warn(sitesquatch::diagnostics::Diagnostic::warning("fetch", format!("fetch: couldn't save {} in {}: {}", ask.url, dir.display(), e)));
                    }
                }
            }
            outcome
        }
        (Some(_), None) => outcome,
    }
}

#[cfg(feature = "fetch")]
fn request(ask: &Ask) -> Outcome {
    use ureq::http;
    use ureq::{RequestExt, ResponseExt};
    static AGENTS: std::sync::OnceLock<(ureq::Agent, ureq::Agent)> = std::sync::OnceLock::new();
    let (follow, manual) = AGENTS.get_or_init(|| {
        let agent = |redirects: u32| -> ureq::Agent {
            ureq::Agent::config_builder()
                .http_status_as_error(false)
                .max_redirects(redirects)
                .save_redirect_history(true)
                .user_agent(concat!("ssqch/", env!("CARGO_PKG_VERSION")))
                .timeout_connect(Some(Duration::from_secs(30)))
                .timeout_recv_response(Some(Duration::from_secs(120)))
                .build()
                .into()
        };
        (agent(20), agent(0))
    });
    let failed = |e: &dyn std::fmt::Display| format!("fetch failed: {}: {}", ask.url, e);
    let mut builder = http::Request::builder().method(ask.method.as_str()).uri(ask.url.as_str());
    for (k, v) in &ask.headers {
        builder = builder.header(k.as_str(), v.as_str());
    }
    let agent = if ask.redirect == "follow" { follow } else { manual };
    let body = ask.body.clone().unwrap_or_default();
    let request = builder.body(body).map_err(|e| failed(&e))?;
    let with_agent = request.with_agent(agent);
    let result = match ask.timeout {
        Some(t) => with_agent.configure().timeout_global(Some(t)).run(),
        None => with_agent.run(),
    };
    let mut response = result.map_err(|e| match e {
        ureq::Error::Timeout(_) => format!("fetch failed: {}: timed out (TimeoutError)", ask.url),
        e => failed(&e),
    })?;
    let status = response.status();
    if ask.redirect == "error" && status.is_redirection() {
        return Err(format!("fetch failed: {}: redirected (redirect: \"error\")", ask.url));
    }
    let url = response.get_uri().to_string();
    let redirected = response.get_redirect_history().is_some_and(|h| h.len() > 1);
    let headers = response.headers().iter().map(|(k, v)| (k.as_str().to_string(), String::from_utf8_lossy(v.as_bytes()).into_owned())).collect();
    let body = if ask.method.eq_ignore_ascii_case("HEAD") { Vec::new() } else { response.body_mut().with_config().limit(1 << 30).read_to_vec().map_err(|e| failed(&e))? };
    Ok(Reply { status: status.as_u16(), status_text: status.canonical_reason().unwrap_or("").to_string(), url, redirected, headers, body })
}
