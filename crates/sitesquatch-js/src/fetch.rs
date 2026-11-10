//! The natives behind `fetch()` in `node.js`. Each request runs on a thread
//! of its own (at most [`MAX_RUNNING`] at once), so `Promise.all` over many
//! URLs fetches them in parallel. JavaScript picks up finished requests in
//! `__ssqch.wait`, when it has nothing else to run.

use std::collections::VecDeque;
use std::sync::{Arc, Condvar, Mutex};
use std::time::Duration;

use rquickjs::prelude::Opt;
use rquickjs::{Ctx, Exception, Function, Object, Result, TypedArray, Value};

/// Requests in flight at once; more wait for a turn.
#[cfg(feature = "fetch")]
const MAX_RUNNING: usize = 8;

/// A finished request: the response, or why there isn't one.
type Outcome = std::result::Result<Reply, String>;

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
}

pub(crate) fn install<'js>(ctx: &Ctx<'js>, native: &Object<'js>) -> Result<()> {
    let fetches = Arc::new(Fetches::default());
    let f = fetches.clone();
    native.set(
        "fetchStart",
        Function::new(ctx.clone(), move |ctx: Ctx<'js>, url: String, method: String, headers: Vec<Vec<String>>, body: Opt<Value<'js>>, redirect: String, timeout_ms: f64| -> Result<u32> {
            let body = match body.0 {
                Some(v) if !v.is_null() && !v.is_undefined() => Some(crate::native::copy_bytes(&TypedArray::<u8>::from_value(v)?)),
                _ => None,
            };
            let headers = headers.into_iter().filter_map(|pair| match <[String; 2]>::try_from(pair) {
                Ok([k, v]) => Some((k, v)),
                Err(_) => None,
            });
            let ask = Ask { url, method, headers: headers.collect(), body, redirect, timeout: (timeout_ms > 0.0).then(|| Duration::from_secs_f64(timeout_ms / 1000.0)) };
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
    let deadline = (timeout_ms >= 0.0).then(|| std::time::Instant::now() + Duration::from_secs_f64(timeout_ms / 1000.0));
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
            let outcome = request(&ask);
            let mut state = f.state.lock().unwrap();
            state.running -= 1;
            state.done.push_back((id, outcome));
            f.changed.notify_all();
        })
        .map_err(|e| format!("fetch failed: {}", e))?;
    Ok(id)
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
