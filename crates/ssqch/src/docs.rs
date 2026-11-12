//! `ssqch docs`: the documentation of the installed version, from the binary.
//!
//! The README is built in (see `build.rs`), so an answer always matches the
//! binary, with no network and no README on disk. `ssqch docs` alone is a
//! card: every command, config option, template function and module export,
//! one line each. `ssqch docs <name>` prints the section that answers, found
//! by name (`base`, `imagePlugin`, `toc`), by another generator's word
//! (`pathPrefix`, which says ssqch's), by heading (`content schemas`), or by
//! the text. `--from <generator>` is the card for someone arriving from one.
//!
//! The one-line descriptions come from where the names are defined:
//! `ssqch.d.ts` for config options and module exports, clap for commands, and
//! `BUILTIN_FILTERS` for template functions. A test checks that every name
//! `ssqch capabilities` lists has a description and a section.

use std::process::ExitCode;

use serde_json::{json, Value as Json};
use sitesquatch::cli::clap;
use sitesquatch::equivalents::{self, Equivalent, Kind};

mod text {
    include!(concat!(env!("OUT_DIR"), "/docs.rs"));
}

const GUIDES_URL: &str = "https://github.com/reverentgeek/sitesquatch/blob";

pub fn docs_command() -> clap::Command {
    clap::Command::new("docs")
        .about("Read the documentation for this version: a command, config option, function or topic")
        .arg(clap::Arg::new("query").num_args(0..).value_name("NAME OR WORDS").help("A name (base, imagePlugin, toc, serve), another generator's word (pathPrefix), or words from a heading (\"content schemas\")"))
        .arg(clap::Arg::new("from").long("from").value_name("GENERATOR").help("Another generator's words and ssqch's names for them: eleventy, hugo, jekyll, zola, ..."))
        .arg(clap::Arg::new("format").long("format").value_name("FORMAT").help("text or json").default_value("text"))
        .after_help(
            "Without a name, it lists everything, one line each.\n\n  ssqch docs\n  ssqch docs base\n  ssqch docs \"content schemas\"\n  ssqch docs pathPrefix          (another generator's word: says ssqch's)\n  ssqch docs --from eleventy\n  ssqch docs -- --starter        (a flag: after --)\n  ssqch docs agents > AGENTS.md  (instructions for coding agents)\n\nThe text is this version's README, built into the binary.",
        )
}

/// A part of the README: a heading and the text under it, up to the next heading.
pub struct Section {
    pub level: usize,
    pub title: String,
    pub body: String,
}

/// The README's sections, in order. `#` lines in code blocks aren't headings.
pub fn sections() -> Vec<Section> {
    let mut out: Vec<Section> = Vec::new();
    let mut fence: Option<&str> = None;
    for line in text::README.lines() {
        let trimmed = line.trim_start();
        let marker = ["```", "~~~"].into_iter().find(|m| trimmed.starts_with(m));
        if let Some(m) = marker {
            match fence {
                None => fence = Some(m),
                // A closing fence is the marker alone; an opening one can name a language.
                Some(open) if open == m && trimmed.trim_end().trim_start_matches(&m[..1]).is_empty() => fence = None,
                _ => {}
            }
        }
        let hashes = line.chars().take_while(|c| *c == '#').count();
        if fence.is_none() && marker.is_none() && (1..=4).contains(&hashes) && line[hashes..].starts_with(' ') {
            out.push(Section { level: hashes, title: line[hashes..].trim().to_string(), body: String::new() });
            continue;
        }
        if let Some(section) = out.last_mut() {
            section.body.push_str(line);
            section.body.push('\n');
        }
    }
    for section in &mut out {
        section.body = section.body.trim_matches('\n').to_string();
    }
    out
}

/// The sections inside section `i` (one level down).
fn children(sections: &[Section], i: usize) -> Vec<usize> {
    let level = sections[i].level;
    let mut out = Vec::new();
    for (j, s) in sections.iter().enumerate().skip(i + 1) {
        if s.level <= level {
            break;
        }
        if s.level == level + 1 {
            out.push(j);
        }
    }
    out
}

/// A name ssqch has, with what it is.
#[derive(Clone)]
pub struct Name {
    pub name: String,
    /// `command`, `config option`, `template function`, `module export` or `flag`.
    pub kind: &'static str,
    /// The module a module export is from, or the command a flag is for (none for a global flag).
    pub module: Option<String>,
    /// What it does, as its definition says.
    pub summary: String,
}

/// The first sentence of `text`, for a line of the card. A long one stops at
/// its colon, when what's before it says enough (`The engine that runs over
/// `.md` files first`).
fn first_sentence(text: &str) -> String {
    let mut in_code = false;
    let mut colon = None;
    for (i, c) in text.char_indices() {
        if c == '`' {
            in_code = !in_code;
        }
        if c == ':' && !in_code && colon.is_none() && text[i + 1..].starts_with(' ') {
            colon = Some(i);
        }
        if c == '.' && !in_code && text[i + 1..].starts_with(' ') {
            let sentence = &text[..=i];
            return match colon {
                Some(at) if sentence.len() > 100 && at > 25 => format!("{}.", &text[..at]),
                _ => sentence.to_string(),
            };
        }
    }
    match colon {
        Some(at) if text.len() > 100 && at > 25 => format!("{}.", &text[..at]),
        _ => text.to_string(),
    }
}

/// Config options and module exports, with their doc comments, from `ssqch.d.ts`.
fn typed_names() -> Vec<Name> {
    let member = regex::Regex::new(r"^\t\t(\w+)\??:").unwrap();
    let function = regex::Regex::new(r"^\texport function (\w+)").unwrap();
    let interface = regex::Regex::new(r"^\texport interface (\w+)").unwrap();
    let mut out: Vec<Name> = Vec::new();
    let (mut module, mut iface, mut doc, mut in_doc) = (String::new(), String::new(), String::new(), false);
    for line in crate::init::TYPES.lines() {
        let t = line.trim();
        if in_doc {
            if t.starts_with("*/") {
                in_doc = false;
            } else {
                doc.push(' ');
                doc.push_str(t.trim_start_matches('*').trim());
            }
            continue;
        }
        if let Some(rest) = t.strip_prefix("/**") {
            match rest.strip_suffix("*/") {
                Some(one) => doc = one.trim().to_string(),
                None => {
                    doc = rest.trim().to_string();
                    in_doc = true;
                }
            }
            continue;
        }
        if let Some(name) = line.strip_prefix("declare module \"").and_then(|r| r.split('"').next()) {
            module = name.to_string();
        } else if let Some(c) = interface.captures(line) {
            iface = c[1].to_string();
        } else if line == "\t}" {
            iface.clear();
        } else if let Some(c) = function.captures(line) {
            if !out.iter().any(|n| n.name == c[1] && n.module.as_deref() == Some(&module)) {
                out.push(Name { name: c[1].to_string(), kind: "module export", module: Some(module.clone()), summary: doc.trim().to_string() });
            }
        } else if let Some(c) = member.captures(line) {
            if module == "ssqch" && (iface == "Config" || iface == "ConfigParts") && !out.iter().any(|n| n.name == c[1] && n.kind == "config option") {
                out.push(Name { name: c[1].to_string(), kind: "config option", module: None, summary: doc.trim().to_string() });
            }
        }
        doc.clear();
    }
    out
}

/// Every name the card lists: commands, config options (in the order a
/// config's errors list them), template functions, then module exports.
pub fn names() -> Vec<Name> {
    let mut out = Vec::new();
    let mut root = sitesquatch::cli::command("ssqch", &crate::extra_commands());
    root.build();
    for sub in root.get_subcommands().filter(|s| !s.is_hide_set() && s.get_name() != "help") {
        out.push(Name { name: sub.get_name().to_string(), kind: "command", module: None, summary: sub.get_about().map(|a| a.to_string()).unwrap_or_default() });
    }
    let typed = typed_names();
    for option in sitesquatch_js::config_options() {
        let summary = typed.iter().find(|n| n.kind == "config option" && n.name == option).map(|n| n.summary.clone()).unwrap_or_default();
        out.push(Name { name: option, kind: "config option", module: None, summary });
    }
    for (name, summary) in sitesquatch::build::BUILTIN_FILTERS {
        out.push(Name { name: name.to_string(), kind: "template function", module: None, summary: summary.to_string() });
    }
    // Only the modules this binary has (`ssqch/sass` is a feature).
    let caps = crate::capabilities::capabilities();
    let modules: Vec<&str> = caps["modules"].as_array().into_iter().flatten().filter_map(|m| m["name"].as_str()).collect();
    out.extend(typed.into_iter().filter(|n| n.kind == "module export" && n.module.as_deref().is_some_and(|m| modules.contains(&m))));
    // Flags, for looking up (the card leaves them to `--help`): the global ones once, then each command's.
    let flag = |arg: &clap::Arg, command: Option<&str>| {
        let long = arg.get_long()?;
        let help = arg.get_long_help().or(arg.get_help()).map(|h| h.to_string()).unwrap_or_default();
        Some(Name { name: format!("--{}", long), kind: "flag", module: command.map(String::from), summary: help.replace('\n', " ") })
    };
    out.extend(root.get_arguments().filter_map(|a| flag(a, None)));
    for sub in root.get_subcommands().filter(|s| !s.is_hide_set() && s.get_name() != "help") {
        out.extend(sub.get_arguments().filter(|a| !a.is_global_set()).filter_map(|a| flag(a, Some(sub.get_name()))));
    }
    out
}

/// Lowercase words, for comparing headings and queries.
fn words(text: &str) -> Vec<String> {
    text.to_lowercase().split(|c: char| !c.is_alphanumeric()).filter(|w| !w.is_empty()).map(String::from).collect()
}

/// A heading's anchor on GitHub: `where-a-value-comes-from`.
fn slug(title: &str) -> String {
    title.to_lowercase().chars().filter_map(|c| if c.is_alphanumeric() || c == '-' || c == '_' { Some(c) } else if c == ' ' { Some('-') } else { None }).collect()
}

/// How often `name` is written as code in `text` (`` `base` ``, `` `base: "/x/"` ``,
/// `` `toc(page.headings)` ``), not counting longer names that start with it.
fn mentions(text: &str, name: &str) -> usize {
    let needle = format!("`{}", name);
    text.match_indices(&needle).filter(|(i, _)| !text[i + needle.len()..].starts_with(|c: char| c.is_alphanumeric() || c == '_' || c == '-')).count()
}

/// A section's body in pieces: paragraphs, list items, table rows (each with
/// the table's header) and code blocks.
fn blocks(body: &str) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    let mut current = String::new();
    let mut fence: Option<&str> = None;
    let mut header = String::new();
    let flush = |current: &mut String, out: &mut Vec<String>| {
        if !current.trim().is_empty() {
            out.push(current.trim_end().to_string());
        }
        current.clear();
    };
    let lines: Vec<&str> = body.lines().collect();
    for (n, line) in lines.iter().enumerate() {
        let trimmed = line.trim_start();
        if let Some(open) = fence {
            current.push_str(line);
            current.push('\n');
            if trimmed.starts_with(open) && trimmed.trim_end().trim_start_matches(&open[..1]).is_empty() {
                fence = None;
                flush(&mut current, &mut out);
            }
            continue;
        }
        if let Some(m) = ["```", "~~~"].into_iter().find(|m| trimmed.starts_with(m)) {
            flush(&mut current, &mut out);
            fence = Some(m);
            current.push_str(line);
            current.push('\n');
            continue;
        }
        if line.trim().is_empty() {
            flush(&mut current, &mut out);
            header.clear();
            continue;
        }
        if line.starts_with('|') {
            flush(&mut current, &mut out);
            let is_separator = |l: &str| l.contains("---") && l.chars().all(|c| "|-: ".contains(c));
            if is_separator(line) {
                continue;
            }
            if header.is_empty() && lines.get(n + 1).is_some_and(|next| is_separator(next)) {
                header = format!("{}\n{}\n", line, lines[n + 1]);
            } else {
                out.push(format!("{}{}", header, line));
            }
            continue;
        }
        let item = trimmed.starts_with("- ") || trimmed.starts_with("* ") || trimmed.split_once(". ").is_some_and(|(n, _)| !n.is_empty() && n.chars().all(|c| c.is_ascii_digit()));
        if item && !line.starts_with("  ") {
            flush(&mut current, &mut out);
        }
        current.push_str(line);
        current.push('\n');
    }
    flush(&mut current, &mut out);
    out
}

/// Where `name` is written as code first in `block`, past a list or table marker, if it is.
fn first_mention(block: &str, name: &str) -> Option<usize> {
    let row = block.lines().last().unwrap_or("");
    let text = if block.starts_with('|') { row } else { block };
    let text = text.trim_start_matches(['|', '-', '*', ' ']);
    let needle = format!("`{}", name);
    text.match_indices(&needle).find(|(i, _)| !text[i + needle.len()..].starts_with(|c: char| c.is_alphanumeric() || c == '_' || c == '-')).map(|(i, _)| i)
}

/// Where the README documents `name`: the blocks that define it (it's the
/// first thing they write as code, as in a table row or a list item), in the
/// section that has the best one, and that section. Without a definition, the
/// block that writes it as code most often.
fn passages(sections: &[Section], name: &str) -> Option<(usize, Vec<String>)> {
    let mut best: Option<(usize, usize, String)> = None;
    let mut defining: Vec<(usize, String)> = Vec::new();
    for (i, s) in sections.iter().enumerate() {
        for block in blocks(&s.body) {
            let n = mentions(&block, name);
            if n == 0 {
                continue;
            }
            let defines = first_mention(&block, name).is_some_and(|at| at < 60);
            if defines {
                defining.push((i, block.clone()));
            }
            let score = n + if defines { 1000 } else { 0 } + mentions(&s.title, name) * 100;
            if best.as_ref().is_none_or(|(_, b, _)| score > *b) {
                best = Some((i, score, block));
            }
        }
    }
    let (section, _, block) = best?;
    let mut found: Vec<String> = defining.into_iter().filter(|(i, _)| *i == section).map(|(_, b)| b).take(3).collect();
    if found.is_empty() {
        found.push(block);
    }
    Some((section, found))
}

/// Other sections that write `name` as code, most often first.
fn also(sections: &[Section], name: &str, not: usize) -> Vec<usize> {
    let mut found: Vec<(usize, usize)> = sections.iter().enumerate().filter(|(i, _)| *i != not).map(|(i, s)| (i, mentions(&s.body, name) + mentions(&s.title, name) * 10)).filter(|(_, n)| *n > 0).collect();
    found.sort_by(|a, b| b.1.cmp(&a.1).then(a.0.cmp(&b.0)));
    found.into_iter().map(|(i, _)| i).take(4).collect()
}

/// The section with heading `title`, by its words (`content schemas`, `Content schemas`) or its anchor.
fn heading(sections: &[Section], query: &str) -> Option<usize> {
    let q = words(query);
    if q.is_empty() {
        return None;
    }
    let anchor = query.trim_start_matches('#');
    if let Some(i) = sections.iter().position(|s| words(&s.title) == q || slug(&s.title) == anchor) {
        return Some(i);
    }
    // Every word of the query starts a word of the heading (`schema` finds "Content schemas"); the shortest heading wins.
    sections
        .iter()
        .enumerate()
        .filter(|(_, s)| {
            let title = words(&s.title);
            q.iter().all(|w| title.iter().any(|t| t.starts_with(w.as_str())))
        })
        .min_by_key(|(_, s)| s.title.len())
        .map(|(i, _)| i)
}

/// The blocks that have every word of `query` (as the start of a word, so
/// `schema` finds "schemas"), best first: the most mentions for their length.
fn search(sections: &[Section], query: &str) -> Vec<(usize, String)> {
    let q = words(query);
    let mut found: Vec<(usize, String, usize)> = Vec::new();
    for (i, s) in sections.iter().enumerate() {
        let title = words(&s.title);
        for block in blocks(&s.body) {
            let text = words(&block);
            let hits: Vec<usize> = q.iter().map(|w| text.iter().chain(&title).filter(|t| t.starts_with(w.as_str())).count()).collect();
            if hits.iter().all(|n| *n > 0) {
                let score = hits.iter().sum::<usize>() * 100_000 / (block.len() + 400);
                found.push((i, block, score));
            }
        }
    }
    found.sort_by(|a, b| b.2.cmp(&a.2).then(a.0.cmp(&b.0)));
    found.into_iter().map(|(i, block, _)| (i, block)).collect()
}

/// Another generator's word: `pathPrefix`, `--drafts`, `eleventy.generator`.
fn foreign(query: &str) -> Option<&'static Equivalent> {
    equivalents::TABLE.iter().find(|e| e.word == query || (e.kind == Kind::Global && query.starts_with(e.word)) || (e.kind == Kind::Global && e.word.trim_end_matches('.') == query))
}

/// What `ssqch docs <query>` found.
pub struct Answer {
    pub query: String,
    /// What the name is: one or more (`markdown` is a config option, a template function and an export).
    pub names: Vec<Name>,
    pub equivalent: Option<&'static Equivalent>,
    /// A command's `--help`.
    pub help: Option<String>,
    pub section: Option<usize>,
    /// The parts of `section` about the name, when the answer isn't the whole section.
    pub passages: Vec<String>,
    /// Other sections that mention it.
    pub also: Vec<usize>,
}

/// `ssqch serve --help`, as `--help` prints it.
fn help(command: &str) -> Option<String> {
    let mut root = sitesquatch::cli::command("ssqch", &crate::extra_commands());
    root.build();
    let sub = root.find_subcommand_mut(command)?;
    Some(sub.render_long_help().to_string().trim_end().to_string())
}

/// Look `query` up: a name ssqch has (a command, config option, function,
/// export or flag), another generator's word, a heading, then the text.
pub fn answer(sections: &[Section], names: &[Name], query: &str) -> Option<Answer> {
    let query = query.trim();
    let query = query.strip_prefix("ssqch ").unwrap_or(query).trim();
    if query.is_empty() {
        return None;
    }
    let blank = Answer { query: query.to_string(), names: Vec::new(), equivalent: None, help: None, section: None, passages: Vec::new(), also: Vec::new() };
    let matching: Vec<Name> = names.iter().filter(|n| n.name == query || (n.kind == "command" && n.name.eq_ignore_ascii_case(query))).cloned().collect();
    if !matching.is_empty() {
        // `serve` is a command and a config option: its --help, then the README on the option.
        let help = matching.iter().find(|n| n.kind == "command").and_then(|c| help(&c.name));
        let others = matching.iter().any(|n| n.kind != "command");
        let mut a = Answer { names: matching, help, ..blank };
        if let Some((section, passages)) = passages(sections, query).filter(|_| others) {
            a.also = also(sections, query, section);
            a.section = Some(section);
            a.passages = passages;
        }
        return Some(a);
    }
    if let Some(e) = foreign(query) {
        // The answer to the hint's own `More: ssqch docs ...`.
        let more = e.more.strip_prefix("ssqch docs ").map(|m| m.trim_matches('"')).filter(|m| *m != query);
        let a = more.and_then(|m| answer(sections, names, m)).unwrap_or(blank);
        return Some(Answer { equivalent: Some(e), query: query.to_string(), ..a });
    }
    if let Some(i) = heading(sections, query) {
        return Some(Answer { section: Some(i), ..blank });
    }
    let bare = query.trim_matches('`');
    if !bare.contains(char::is_whitespace) {
        if let Some((section, passages)) = passages(sections, bare) {
            return Some(Answer { also: also(sections, bare, section), section: Some(section), passages, ..blank });
        }
    }
    let found = search(sections, query);
    let (section, block) = found.first()?.clone();
    let mut others: Vec<usize> = Vec::new();
    for (i, _) in &found {
        if *i != section && !others.contains(i) {
            others.push(*i);
        }
    }
    others.truncate(4);
    Some(Answer { section: Some(section), passages: vec![block], also: others, ..blank })
}

/// A name, heading or word close to `query`, for "did you mean".
fn closest(sections: &[Section], names: &[Name], query: &str) -> Option<String> {
    let mut candidates: Vec<&str> = names.iter().map(|n| n.name.as_str()).collect();
    candidates.extend(sections.iter().map(|s| s.title.as_str()));
    candidates.extend(equivalents::TABLE.iter().map(|e| e.word));
    sitesquatch::suggest::closest(query, candidates.into_iter()).map(String::from)
}

fn what(name: &Name) -> String {
    match (name.kind, &name.module) {
        ("flag", Some(command)) => format!("`{}` (flag of ssqch {})", name.name, command),
        ("flag", None) => format!("`{}` (flag of every command)", name.name),
        (_, Some(module)) => format!("`{}` (from \"{}\")", name.name, module),
        (kind, None) => format!("`{}` ({})", name.name, kind),
    }
}

fn section_text(sections: &[Section], i: usize) -> String {
    let s = &sections[i];
    let mut out = format!("{} {}\n", "#".repeat(s.level.max(2)), s.title);
    if !s.body.is_empty() {
        out.push('\n');
        out.push_str(&s.body);
        out.push('\n');
    }
    let inside = children(sections, i);
    if !inside.is_empty() {
        let titles: Vec<String> = inside.iter().map(|j| format!("\"{}\"", sections[*j].title)).collect();
        out.push_str(&format!("\nIn this section (ssqch docs \"<title>\"): {}\n", titles.join(", ")));
    }
    out
}

fn answer_text(sections: &[Section], a: &Answer) -> String {
    let mut out = String::new();
    if let Some(e) = a.equivalent {
        let from = match e.from {
            [one] => format!(" ({})", one),
            _ => String::new(),
        };
        let verdict = if e.alias { "works in ssqch too" } else { "isn't ssqch's word" };
        out.push_str(&format!("`{}`{} {}. {}\n\n", e.word.trim_end_matches('.'), from, verdict, e.say));
    }
    if let Some(help) = &a.help {
        out.push_str(help);
        out.push_str("\n\n");
    }
    let described: Vec<&Name> = a.names.iter().filter(|n| n.kind != "command" || a.help.is_none()).collect();
    for name in &described {
        out.push_str(&format!("{}: {}\n", what(name), name.summary));
    }
    if !described.is_empty() {
        out.push('\n');
    }
    match a.section {
        Some(i) if !a.passages.is_empty() => {
            out.push_str(&format!("From \"{}\" (ssqch docs \"{}\"):\n\n", sections[i].title, sections[i].title));
            out.push_str(&a.passages.join("\n\n"));
            out.push('\n');
        }
        Some(i) => out.push_str(&section_text(sections, i)),
        None if a.help.is_none() => {
            if let Some(e) = a.equivalent {
                out.push_str(&format!("More: {}\n", e.more));
            }
        }
        None => {}
    }
    if !a.also.is_empty() {
        let titles: Vec<String> = a.also.iter().map(|j| format!("\"{}\"", sections[*j].title)).collect();
        out.push_str(&format!("\nAlso in: {}\n", titles.join(", ")));
    }
    out.trim_end().to_string() + "\n"
}

fn answer_json(sections: &[Section], a: &Answer) -> Json {
    let mut out = json!({ "query": a.query, "found": true });
    if !a.names.is_empty() {
        out["names"] = json!(a.names.iter().map(|n| json!({ "name": n.name, "kind": n.kind, "module": n.module, "summary": n.summary })).collect::<Vec<_>>());
    }
    if let Some(e) = a.equivalent {
        out["equivalent"] = e.to_json();
        out["equivalent"]["say"] = json!(e.say);
    }
    if let Some(help) = &a.help {
        out["help"] = json!(help);
    }
    if let Some(i) = a.section {
        let text = if a.passages.is_empty() { sections[i].body.clone() } else { a.passages.join("\n\n") };
        out["section"] = json!({
            "title": sections[i].title,
            "anchor": slug(&sections[i].title),
            "whole": a.passages.is_empty(),
            "text": text,
            "sections": children(sections, i).iter().map(|j| sections[*j].title.clone()).collect::<Vec<_>>(),
        });
    }
    if !a.also.is_empty() {
        out["also"] = json!(a.also.iter().map(|j| sections[*j].title.clone()).collect::<Vec<_>>());
    }
    out
}

/// `ssqch docs` alone: everything, one line each.
fn card(sections: &[Section], names: &[Name]) -> String {
    let mut out = format!("ssqch {}. `ssqch docs <name>` for one, `ssqch docs --from <generator>` for another generator's words, `ssqch docs agents` for an AGENTS.md.\n", env!("CARGO_PKG_VERSION"));
    let mut group = |title: &str, rows: Vec<(&str, &str)>, indent: usize| {
        if rows.is_empty() {
            return;
        }
        if !title.is_empty() {
            out.push_str(&format!("\n{}\n", title));
        }
        let width = rows.iter().map(|(n, _)| n.len()).max().unwrap_or(0);
        for (name, summary) in rows {
            out.push_str(&format!("{}{:<width$}  {}\n", " ".repeat(indent), name, first_sentence(summary), width = width));
        }
    };
    let of = |kind: &str| names.iter().filter(|n| n.kind == kind).map(|n| (n.name.as_str(), n.summary.as_str())).collect::<Vec<_>>();
    group("Commands", of("command"), 2);
    group("Config options (ssqch.config.js)", of("config option"), 2);
    group("Template functions", of("template function"), 2);
    let mut modules: Vec<&str> = Vec::new();
    for n in names.iter().filter(|n| n.kind == "module export") {
        if let Some(m) = n.module.as_deref().filter(|m| !modules.contains(m)) {
            modules.push(m);
        }
    }
    out.push_str("\nModules (import { name } from \"module\")\n");
    for module in modules {
        let rows = names.iter().filter(|n| n.module.as_deref() == Some(module)).map(|n| (n.name.as_str(), n.summary.as_str())).collect::<Vec<_>>();
        let width = rows.iter().map(|(n, _)| n.len()).max().unwrap_or(0);
        out.push_str(&format!("  {}\n", module));
        for (name, summary) in rows {
            out.push_str(&format!("    {:<width$}  {}\n", name, first_sentence(summary), width = width));
        }
    }
    let topics: Vec<&str> = sections.iter().filter(|s| s.level == 2).map(|s| s.title.as_str()).collect();
    out.push_str(&format!("\nTopics\n  {}\n", topics.join(", ")));
    out
}

fn card_json(sections: &[Section], names: &[Name]) -> Json {
    let rows = |kind: &str| names.iter().filter(|n| n.kind == kind).map(|n| json!({ "name": n.name, "summary": n.summary })).collect::<Vec<_>>();
    let mut modules: Vec<Json> = Vec::new();
    for n in names.iter().filter(|n| n.kind == "module export") {
        let module = n.module.clone().unwrap_or_default();
        let row = json!({ "name": n.name, "summary": n.summary });
        match modules.iter_mut().find(|m| m["name"] == module.as_str()) {
            Some(m) => m["exports"].as_array_mut().unwrap().push(row),
            None => modules.push(json!({ "name": module, "exports": [row] })),
        }
    }
    json!({
        "version": env!("CARGO_PKG_VERSION"),
        "commands": rows("command"),
        "configOptions": rows("config option"),
        "templateFunctions": rows("template function"),
        "modules": modules,
        "topics": sections.iter().filter(|s| s.level == 2).map(|s| s.title.clone()).collect::<Vec<_>>(),
    })
}

/// The generators the table and the guides know, by name.
fn generators() -> Vec<&'static str> {
    let mut out: Vec<&'static str> = Vec::new();
    let from_table = equivalents::TABLE.iter().flat_map(|e| e.from.iter().copied());
    let from_configs = equivalents::OTHER_CONFIGS.iter().map(|(_, generator, ..)| *generator);
    for g in from_table.chain(from_configs) {
        if !out.contains(&g) {
            out.push(g);
        }
    }
    out
}

/// The guide for `generator`: its file name, and its text when it's built in.
fn guide(generator: &str) -> Option<(String, Option<&'static str>)> {
    let file = equivalents::OTHER_CONFIGS.iter().find(|(_, g, ..)| *g == generator).and_then(|(.., guide)| *guide).map(String::from).or_else(|| {
        let file = format!("from-{}.md", generator.to_lowercase());
        text::TRAILHEADS.iter().any(|(name, _)| *name == file).then_some(file)
    })?;
    let text = text::TRAILHEADS.iter().find(|(name, _)| *name == file).map(|(_, text)| *text);
    Some((file, text))
}

fn guide_url(file: &str) -> String {
    format!("{}/v{}/docs/trailheads/{}", GUIDES_URL, env!("CARGO_PKG_VERSION"), file)
}

/// `ssqch docs --from <generator>`: its words, ssqch's names for them, and its trailhead.
fn from(generator: &str, json: bool) -> Result<String, String> {
    let known = generators();
    let Some(generator) = known.iter().find(|g| g.eq_ignore_ascii_case(generator) || g.replace('.', "").eq_ignore_ascii_case(generator)).copied() else {
        let hint = sitesquatch::suggest::closest(&generator.to_lowercase(), known.iter().map(|g| g.to_lowercase()).collect::<Vec<_>>().iter().map(String::as_str)).map(|g| format!(" (did you mean `{}`?)", g)).unwrap_or_default();
        return Err(format!("--from {}: no trailhead for that generator{}. There are: {}", generator, hint, known.iter().map(|g| g.to_lowercase()).collect::<Vec<_>>().join(", ")));
    };
    let theirs: Vec<&Equivalent> = equivalents::TABLE.iter().filter(|e| e.from.contains(&generator)).collect();
    let everyone: Vec<&Equivalent> = equivalents::TABLE.iter().filter(|e| e.from.is_empty()).collect();
    let guide = guide(generator);
    if json {
        let rows = |list: &[&Equivalent]| list.iter().map(|e| {
            let mut row = e.to_json();
            row["say"] = json!(e.say);
            row
        }).collect::<Vec<_>>();
        let value = json!({
            "generator": generator,
            "words": rows(&theirs),
            "common": rows(&everyone),
            "trailhead": guide.as_ref().map(|(file, text)| json!({ "file": format!("docs/trailheads/{}", file), "url": guide_url(file), "text": text })),
        });
        return Ok(serde_json::to_string_pretty(&value).unwrap_or_default() + "\n");
    }
    let mut out = format!("{}'s words, and ssqch's names for them. The ones marked (works) are aliases: they do the same as ssqch's name, and say it once. The others are refused with this hint.\n", generator);
    let kinds = [(Kind::Command, "Commands"), (Kind::Flag, "Flags"), (Kind::Config, "Config"), (Kind::FrontMatter, "Front matter"), (Kind::Filter, "Filters"), (Kind::Global, "In templates")];
    let shown = |e: &Equivalent| {
        let word = if e.kind == Kind::Global && e.word.ends_with('.') { format!("{}*", e.word) } else { e.word.to_string() };
        if e.alias { format!("{} (works)", word) } else { word }
    };
    let rows = |list: &[&&Equivalent]| {
        let width = list.iter().map(|e| shown(e).len()).max().unwrap_or(0);
        list.iter().map(|e| format!("  {:<width$}  {}\n", shown(e), e.say, width = width)).collect::<String>()
    };
    for (kind, label) in kinds {
        let list: Vec<&&Equivalent> = theirs.iter().filter(|e| e.kind == kind).collect();
        if !list.is_empty() {
            out.push_str(&format!("\n{}\n{}", label, rows(&list)));
        }
    }
    if !everyone.is_empty() {
        out.push_str(&format!("\nWords most generators use\n{}", rows(&everyone.iter().collect::<Vec<_>>())));
    }
    match guide {
        Some((file, Some(text))) => out.push_str(&format!("\nThe trailhead (docs/trailheads/{}):\n\n{}\n", file, text.trim_end())),
        Some((file, None)) => out.push_str(&format!("\nThe trailhead: {}\n", guide_url(&file))),
        None => out.push_str("\nThere's no trailhead for it yet; `ssqch docs trailheads` has the general route.\n"),
    }
    Ok(out)
}

pub fn run_docs(matches: &clap::ArgMatches) -> ExitCode {
    let format = matches.get_one::<String>("format").map(String::as_str).unwrap_or("text");
    if format != "text" && format != "json" {
        eprintln!("{} --format {}: use text or json", sitesquatch::diagnostics::red("error:"), format);
        return ExitCode::FAILURE;
    }
    let json = format == "json";
    let query: Vec<&str> = matches.get_many::<String>("query").into_iter().flatten().map(String::as_str).collect();
    if let Some(generator) = matches.get_one::<String>("from") {
        if !query.is_empty() {
            eprintln!("{} --from lists one generator's words; leave out `{}`, or look it up without --from", sitesquatch::diagnostics::red("error:"), query.join(" "));
            return ExitCode::FAILURE;
        }
        return match from(generator, json) {
            Ok(text) => {
                print!("{}", text);
                ExitCode::SUCCESS
            }
            Err(message) => {
                eprintln!("{} {}", sitesquatch::diagnostics::red("error:"), message);
                ExitCode::FAILURE
            }
        };
    }
    let sections = sections();
    let names = names();
    if query.is_empty() {
        if json {
            println!("{}", serde_json::to_string_pretty(&card_json(&sections, &names)).unwrap_or_default());
        } else {
            print!("{}", card(&sections, &names));
        }
        return ExitCode::SUCCESS;
    }
    let query = query.join(" ");
    // The AGENTS.md a starter has, for a site that doesn't have one yet.
    if query == "agents" {
        let text = crate::init::agents_md(None);
        if json {
            println!("{}", serde_json::to_string_pretty(&json!({ "query": query, "found": true, "agentsMd": text })).unwrap_or_default());
        } else {
            print!("{}", text);
        }
        return ExitCode::SUCCESS;
    }
    match answer(&sections, &names, &query) {
        Some(a) if json => println!("{}", serde_json::to_string_pretty(&answer_json(&sections, &a)).unwrap_or_default()),
        Some(a) => print!("{}", answer_text(&sections, &a)),
        None => {
            let hint = closest(&sections, &names, &query);
            if json {
                println!("{}", serde_json::to_string_pretty(&json!({ "query": query, "found": false, "didYouMean": hint })).unwrap_or_default());
            } else {
                let hint = hint.map(|h| format!(" (did you mean `{}`?)", h)).unwrap_or_default();
                eprintln!("{} no tracks of \"{}\" in the docs{}. `ssqch docs` lists everything.", sitesquatch::diagnostics::red("error:"), query, hint);
            }
            return ExitCode::FAILURE;
        }
    }
    ExitCode::SUCCESS
}
