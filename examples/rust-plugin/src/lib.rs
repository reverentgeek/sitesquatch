//! trail-guide: an example ssqch plugin in Rust, with each kind of hook a plugin can have.
//!
//! - An **engine** for `.trail` files: a trail's stops, one a line, as a list.
//! - **Filters**: `readingTime(html)`, `greet(name)` and `tally(items, key)`.
//! - A **transform** that gives links to other sites `rel="external"`.
//!
//! None of these is work that needs Rust: a regex in JavaScript does the transform as fast. The
//! README in this folder says when Rust pays; this plugin is the shape to start from.

use ssqch_plugin::{export, Hooks, Page, Plugin, Value};

/// The options a site passes: `trailGuide({ greeting: "Howdy", wordsPerMinute: 180 })`.
#[derive(serde::Deserialize)]
#[serde(default, deny_unknown_fields, rename_all = "camelCase")]
pub struct Options {
    /// What `greet` says first. Default `"Hello"`.
    pub greeting: String,
    /// How fast `readingTime` reads. Default 200.
    pub words_per_minute: u32,
    /// The `rel` the transform gives links to other sites, or `""` to leave them alone. Default
    /// `"external"`.
    pub external_rel: String,
}

impl Default for Options {
    fn default() -> Self {
        Options { greeting: "Hello".into(), words_per_minute: 200, external_rel: "external".into() }
    }
}

pub struct TrailGuide {
    options: Options,
}

impl Plugin for TrailGuide {
    type Options = Options;
    const NAME: &'static str = "trail-guide";
    const HOOKS: Hooks = Hooks { transform: true, filters: &["readingTime", "greet", "tally"], engines: &["trail"] };

    fn new(options: Options) -> Result<Self, String> {
        if options.words_per_minute == 0 {
            return Err("wordsPerMinute must be at least 1".into());
        }
        Ok(TrailGuide { options })
    }

    fn transform(&self, html: &str, _page: &Page) -> Result<Option<String>, String> {
        if self.options.external_rel.is_empty() {
            return Ok(None);
        }
        Ok(mark_external_links(html, &self.options.external_rel))
    }

    fn filter(&self, name: &str, args: &[Value]) -> Result<Value, String> {
        let arg = |i: usize| args.get(i).unwrap_or(&Value::Null);
        match name {
            "readingTime" => {
                let Some(html) = arg(0).as_str() else { return Err(format!("readingTime expects text, got {}", kind(arg(0)))) };
                let words = text_of(html).split_whitespace().count() as u32;
                Ok(Value::from(words.div_ceil(self.options.words_per_minute).max(1)))
            }
            "greet" => match arg(0) {
                Value::Null => Err("greet needs a name, like greet(\"Sasquatch\")".into()),
                Value::String(name) => Ok(Value::from(format!("{}, {}", self.options.greeting, name))),
                other => Ok(Value::from(format!("{}, {}", self.options.greeting, other))),
            },
            "tally" => tally(arg(0), arg(1)),
            _ => Err(format!("no filter named {name}")),
        }
    }

    fn render(&self, _ext: &str, source: &str, page: &Page) -> Result<String, String> {
        render_trail(source, &page.data())
    }
}

export!(TrailGuide);

/// How an error names a value that isn't what a filter wanted.
fn kind(value: &Value) -> &'static str {
    match value {
        Value::Null => "nothing",
        Value::Bool(_) => "true or false",
        Value::Number(_) => "a number",
        Value::String(_) => "text",
        Value::Array(_) => "a list",
        Value::Object(_) => "an object",
    }
}

/// HTML's text: everything outside `<...>`.
fn text_of(html: &str) -> String {
    let mut out = String::with_capacity(html.len());
    let mut in_tag = false;
    for c in html.chars() {
        match c {
            '<' => in_tag = true,
            '>' if in_tag => {
                in_tag = false;
                out.push(' ');
            }
            _ if !in_tag => out.push(c),
            _ => {}
        }
    }
    out
}

/// `tally(sightings, "creature")`: how many items have each value of `key`, in the order the
/// values first appear (`{ "Sasquatch": 2, "elk": 1 }`).
fn tally(items: &Value, key: &Value) -> Result<Value, String> {
    let Some(items) = items.as_array() else { return Err(format!("tally expects a list, got {}", kind(items))) };
    let Some(key) = key.as_str() else { return Err(format!("tally needs the key to count by, like tally(sightings, \"creature\"), got {}", kind(key))) };
    let mut counts = serde_json::Map::new();
    for item in items {
        let name = match item.get(key) {
            Some(Value::String(s)) => s.clone(),
            Some(Value::Null) | None => continue,
            Some(other) => other.to_string(),
        };
        let count = counts.entry(name).or_insert(Value::from(0u32));
        *count = Value::from(count.as_u64().unwrap_or(0) + 1);
    }
    Ok(Value::Object(counts))
}

fn escape(s: &str) -> String {
    s.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;").replace('"', "&quot;")
}

/// A `.trail` file as HTML. A line is a title (`# Cedar Trail`) or a stop: its distance in
/// miles, its name, and a note after `|`. Without a title line, the page's `title` is used.
///
/// ```text
/// # Cedar Trail
/// 0.0 Ranger station
/// 1.2 Old Growth junction | Fork left for the falls.
/// ```
fn render_trail(source: &str, data: &Value) -> Result<String, String> {
    let mut title = data.get("title").and_then(Value::as_str).map(String::from);
    let mut stops: Vec<(f64, String, Option<String>)> = Vec::new();
    for (i, line) in source.lines().enumerate() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        if let Some(heading) = line.strip_prefix("# ") {
            title = Some(heading.trim().to_string());
            continue;
        }
        let (miles, rest) = line.split_once(char::is_whitespace).unwrap_or((line, ""));
        let Ok(miles) = miles.parse::<f64>() else {
            return Err(format!("line {}: a stop starts with its distance in miles, like \"1.2 Old Growth junction\"", i + 1));
        };
        if let Some((before, _, _)) = stops.last() {
            if miles < *before {
                return Err(format!("line {}: {} miles is before the stop above it ({})", i + 1, miles, before));
            }
        }
        let (name, note) = match rest.split_once('|') {
            Some((name, note)) => (name.trim().to_string(), Some(note.trim().to_string())),
            None => (rest.trim().to_string(), None),
        };
        stops.push((miles, name, note));
    }
    let mut html = String::new();
    if let Some(title) = title {
        html.push_str(&format!("<h1>{}</h1>\n", escape(&title)));
    }
    html.push_str("<ol class=\"trail\">\n");
    for (miles, name, note) in &stops {
        html.push_str(&format!("  <li><span class=\"miles\">{:.1} mi</span> {}", miles, escape(name)));
        if let Some(note) = note {
            html.push_str(&format!(" <small>{}</small>", escape(note)));
        }
        html.push_str("</li>\n");
    }
    html.push_str("</ol>\n");
    if let Some((miles, _, _)) = stops.last() {
        html.push_str(&format!("<p class=\"trail-length\">{:.1} miles</p>\n", miles));
    }
    Ok(html)
}

/// Gives each `<a>` whose `href` goes to another site (`https://`, `http://` or `//`) and that
/// has no `rel` the `rel` given. `None` when no link changed.
fn mark_external_links(html: &str, rel: &str) -> Option<String> {
    let lower = html.to_ascii_lowercase();
    let mut out = String::new();
    let mut copied = 0;
    let mut at = 0;
    while let Some(found) = lower[at..].find("<a") {
        let start = at + found;
        at = start + 2;
        // `<a ` or `<a\n`, not `<abbr>`.
        if !lower[at..].starts_with(|c: char| c.is_ascii_whitespace()) {
            continue;
        }
        let Some(end) = tag_end(html, at) else { break };
        let tag = &lower[start..end];
        if attribute(tag, "rel").is_none() && attribute(tag, "href").is_some_and(|href| href.starts_with("https://") || href.starts_with("http://") || href.starts_with("//")) {
            let close = if html[..end].ends_with("/>") { end - 2 } else { end - 1 };
            out.push_str(&html[copied..close]);
            out.push_str(&format!(" rel=\"{}\"", escape(rel)));
            copied = close;
        }
        at = end;
    }
    if copied == 0 {
        return None;
    }
    out.push_str(&html[copied..]);
    Some(out)
}

/// Where the tag that starts before `from` ends (after its `>`), past quoted values.
fn tag_end(html: &str, from: usize) -> Option<usize> {
    let mut quote = None;
    for (i, c) in html[from..].char_indices() {
        match (quote, c) {
            (Some(q), c) if c == q => quote = None,
            (None, '"' | '\'') => quote = Some(c),
            (None, '>') => return Some(from + i + 1),
            _ => {}
        }
    }
    None
}

/// An attribute's value in a (lowercased) tag: `Some("")` for one without a value.
fn attribute<'a>(tag: &'a str, name: &str) -> Option<&'a str> {
    let mut rest = tag.trim_start_matches('<').trim_end_matches('>').trim_end_matches('/');
    rest = rest.split_once(|c: char| c.is_ascii_whitespace()).map(|(_, r)| r).unwrap_or("");
    loop {
        rest = rest.trim_start();
        if rest.is_empty() {
            return None;
        }
        let n = rest.find(|c: char| c.is_ascii_whitespace() || c == '=').unwrap_or(rest.len());
        let key = &rest[..n];
        rest = rest[n..].trim_start();
        let value = if let Some(after) = rest.strip_prefix('=') {
            let after = after.trim_start();
            match after.chars().next() {
                Some(q @ ('"' | '\'')) => {
                    let close = after[1..].find(q).map(|e| e + 1).unwrap_or(after.len());
                    rest = after.get(close + 1..).unwrap_or("");
                    &after[1..close]
                }
                _ => {
                    let e = after.find(|c: char| c.is_ascii_whitespace()).unwrap_or(after.len());
                    rest = &after[e..];
                    &after[..e]
                }
            }
        } else {
            ""
        };
        if key == name {
            return Some(value);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn guide(options: &str) -> TrailGuide {
        ssqch_plugin::create::<TrailGuide>(options).unwrap()
    }

    #[test]
    fn options_have_defaults_and_misspellings_fail() {
        assert_eq!(guide("").options.greeting, "Hello");
        assert_eq!(guide(r#"{ "greeting": "Howdy" }"#).options.greeting, "Howdy");
        let Err(e) = ssqch_plugin::create::<TrailGuide>(r#"{ "greting": "Howdy" }"#) else { panic!() };
        assert!(e.starts_with("options: unknown field `greting`, expected one of `greeting`, `wordsPerMinute`, `externalRel`"), "{e}");
        let Err(e) = ssqch_plugin::create::<TrailGuide>(r#"{ "wordsPerMinute": 0 }"#) else { panic!() };
        assert_eq!(e, "wordsPerMinute must be at least 1");
    }

    #[test]
    fn filters() {
        let g = guide(r#"{ "greeting": "Howdy", "wordsPerMinute": 2 }"#);
        assert_eq!(g.filter("greet", &[json!("Sasquatch")]).unwrap(), "Howdy, Sasquatch");
        assert_eq!(g.filter("greet", &[json!(3)]).unwrap(), "Howdy, 3");
        assert!(g.filter("greet", &[]).is_err());
        assert_eq!(g.filter("readingTime", &[json!("<p>one two <b>three</b></p>")]).unwrap(), 2);
        assert_eq!(g.filter("readingTime", &[json!("")]).unwrap(), 1);
        assert_eq!(g.filter("readingTime", &[json!(3)]).unwrap_err(), "readingTime expects text, got a number");
        let sightings = json!([{ "creature": "Sasquatch" }, { "creature": "elk" }, { "creature": "Sasquatch" }, { "where": "Cedar Trail" }]);
        assert_eq!(serde_json::to_string(&g.filter("tally", &[sightings, json!("creature")]).unwrap()).unwrap(), r#"{"Sasquatch":2,"elk":1}"#);
        assert!(g.filter("tally", &[json!("pine cones"), json!("x")]).unwrap_err().starts_with("tally expects a list, got text"));
    }

    #[test]
    fn a_trail_renders_as_a_list() {
        let html = render_trail("# Cedar Trail\n0 Ranger station\n1.25 Old Growth junction | Fork <left>.\n\n2.4 Pine cone overlook\n", &Value::Null).unwrap();
        assert_eq!(
            html,
            "<h1>Cedar Trail</h1>\n<ol class=\"trail\">\n  <li><span class=\"miles\">0.0 mi</span> Ranger station</li>\n  <li><span class=\"miles\">1.2 mi</span> Old Growth junction <small>Fork &lt;left&gt;.</small></li>\n  <li><span class=\"miles\">2.4 mi</span> Pine cone overlook</li>\n</ol>\n<p class=\"trail-length\">2.4 miles</p>\n"
        );
        assert!(render_trail("1 Stump", &json!({ "title": "Old Growth" })).unwrap().starts_with("<h1>Old Growth</h1>"));
        assert_eq!(render_trail("0 Start\nhalfway Stump", &Value::Null).unwrap_err(), "line 2: a stop starts with its distance in miles, like \"1.2 Old Growth junction\"");
        assert_eq!(render_trail("2 Start\n1 Stump", &Value::Null).unwrap_err(), "line 2: 1 miles is before the stop above it (2)");
    }

    #[test]
    fn links_to_other_sites_get_rel() {
        let g = guide("");
        let html = "<a href=\"/about/\">About</a> <A HREF='https://example.com/a>b'>Out</A> <a href=//cdn.example.com/x rel=me>Me</a> <abbr>x</abbr><a\nhref=\"http://old.example.com\"/>";
        assert_eq!(
            g.transform(html, &Page::default()).unwrap().as_deref(),
            Some("<a href=\"/about/\">About</a> <A HREF='https://example.com/a>b' rel=\"external\">Out</A> <a href=//cdn.example.com/x rel=me>Me</a> <abbr>x</abbr><a\nhref=\"http://old.example.com\" rel=\"external\"/>")
        );
        assert_eq!(g.transform("<p><a href=\"/\">Home</a></p>", &Page::default()).unwrap(), None);
        assert_eq!(guide(r#"{ "externalRel": "" }"#).transform(html, &Page::default()).unwrap(), None);
    }
}
