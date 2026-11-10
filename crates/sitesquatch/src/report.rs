//! The summary printed after a build:
//!
//! ```text
//! Built in 129 ms (production)
//!   Pages    168 written from 160 templates, 14.2 MB
//!   Drafts   3 unconfirmed (built in development only)
//!   Copied   12 files, 3 unchanged, 1.1 MB
//!   Images   4,689 files from 812 sources, 268 MB: 0 encoded, 4,689 reused
//!   Output   dist: 4,882 files, 284 MB
//!   Time     setup 2 ms, data 21 ms, read 9 ms, ..., after 18 ms
//! ```
//!
//! Plugins add lines (like `Images`) with [`Config::add_summary`], and can
//! use [`count`], [`bytes`] and [`duration`] to format them the same way.

use std::fmt::Write as _;
use std::path::Path;
use std::time::Duration;

use crate::config::{BuildReport, Config};

/// The whole summary, ending in a newline.
pub fn summary(cfg: &Config, report: &BuildReport) -> String {
    let ctx = cfg.build_context();
    let mut lines: Vec<(String, String)> = Vec::new();

    let mut pages = format!("{} written", count(report.pages_written));
    if report.templates > 0 {
        pages.push_str(&format!(" from {} template{}", count(report.templates), plural(report.templates)));
    }
    if report.pages_written > 0 {
        pages.push_str(&format!(", {}", bytes(report.page_bytes)));
    }
    // Since the last build: what's new, what's gone, and (while serving) what changed.
    let mut since = Vec::new();
    if let Some(n) = report.pages_new.filter(|n| *n > 0) {
        since.push(format!("{} new", count(n)));
    }
    if let Some(n) = report.pages_gone.filter(|n| *n > 0) {
        since.push(format!("{} gone", count(n)));
    }
    if let Some(n) = report.pages_changed {
        since.push(format!("{} changed", count(n)));
    }
    if !since.is_empty() {
        pages.push_str(&format!(" ({})", since.join(", ")));
    }
    lines.push(("Pages".into(), pages));
    if report.drafts > 0 {
        lines.push(("Drafts".into(), format!("{} unconfirmed (built in development only)", count(report.drafts))));
    }

    let passthrough = report.files_copied + report.files_unchanged;
    if passthrough > 0 {
        let mut copied = format!("{} file{}", count(report.files_copied), plural(report.files_copied));
        if report.files_unchanged > 0 {
            copied.push_str(&format!(", {} unchanged", count(report.files_unchanged)));
        }
        copied.push_str(&format!(", {}", bytes(report.passthrough_bytes)));
        lines.push(("Copied".into(), copied));
    }
    if report.files_removed > 0 {
        lines.push(("Removed".into(), format!("{} stale file{}, {}", count(report.files_removed), plural(report.files_removed), crate::voice::LEFT_NO_TRACE)));
    }

    lines.extend(report.summary.iter().cloned());

    let (files, size) = dir_size(&ctx.output_dir);
    let output = ctx.output_dir.strip_prefix(&ctx.root).unwrap_or(&ctx.output_dir);
    lines.push(("Output".into(), format!("{}: {} file{}, {}", output.display(), count(files), plural(files), bytes(size))));

    let phases: Vec<String> = report.timings.iter().map(|(label, d)| format!("{} {}", label, duration(*d))).collect();
    if !phases.is_empty() {
        lines.push(("Time".into(), phases.join(", ")));
    }

    let width = lines.iter().map(|(label, _)| label.len()).max().unwrap_or(0);
    // A site's first build gets a word before the usual line.
    let first = if report.first_build { format!("{} ", crate::voice::FIRST_SITING) } else { String::new() };
    let mut out = format!("{}Built in {} ({})\n", first, duration(report.duration), cfg.env.as_str());
    for (label, text) in lines {
        let _ = writeln!(out, "  {:<width$}  {}", label, text, width = width);
    }
    if !report.unused.is_empty() {
        let n = report.unused.len();
        let _ = writeln!(out, "Uninhabited: {} Edge template{} that nothing used in this build ({}).", count(n), plural(n), report.unused.join(", "));
    }
    // Nothing to build is usually a wrong folder or a missing extension.
    if report.templates == 0 && report.drafts == 0 && report.pages_written == 0 {
        let input = ctx.input_dir.strip_prefix(&ctx.root).unwrap_or(&ctx.input_dir);
        let _ = writeln!(out, "Nothing sighted: no file in {} matches templateFormats ({}).", crate::slashes(input), cfg.template_formats.join(", "));
    }
    out
}

/// Every file under `dir` (recursively) and their total size.
fn dir_size(dir: &Path) -> (usize, u64) {
    let mut files = 0;
    let mut size = 0;
    for entry in walkdir::WalkDir::new(dir).into_iter().filter_map(Result::ok) {
        if entry.file_type().is_file() {
            files += 1;
            size += entry.metadata().map(|m| m.len()).unwrap_or(0);
        }
    }
    (files, size)
}

fn plural(n: usize) -> &'static str {
    if n == 1 {
        ""
    } else {
        "s"
    }
}

/// `4689` as `4,689`.
pub fn count(n: usize) -> String {
    let digits = n.to_string();
    let mut out = String::new();
    for (i, c) in digits.chars().enumerate() {
        if i > 0 && (digits.len() - i).is_multiple_of(3) {
            out.push(',');
        }
        out.push(c);
    }
    out
}

/// A size in bytes, as `512 B`, `14.2 KB`, `268 MB` or `1.41 GB` (powers of 1,000).
pub fn bytes(n: u64) -> String {
    const UNITS: [&str; 4] = ["KB", "MB", "GB", "TB"];
    if n < 1000 {
        return format!("{} B", n);
    }
    let mut value = n as f64;
    let mut unit = "";
    for u in UNITS {
        value /= 1000.0;
        unit = u;
        // 999.5 and up would round to "1000", so move to the next unit.
        if value < 999.5 {
            break;
        }
    }
    format!("{} {}", three_digits(value), unit)
}

/// A duration as `850 µs`, `129 ms`, `1.24 s` or `2m 05s`.
pub fn duration(d: Duration) -> String {
    let secs = d.as_secs_f64();
    if secs >= 60.0 {
        let whole = secs.round() as u64;
        format!("{}m {:02}s", whole / 60, whole % 60)
    } else if secs >= 1.0 {
        format!("{} s", three_digits(secs))
    } else if secs >= 0.001 {
        format!("{} ms", three_digits(secs * 1000.0))
    } else {
        format!("{} µs", (secs * 1_000_000.0).round())
    }
}

/// About three significant digits: `1.24`, `14.2`, `268`.
fn three_digits(v: f64) -> String {
    if v >= 99.95 {
        format!("{:.0}", v)
    } else if v >= 9.995 {
        format!("{:.1}", v)
    } else {
        format!("{:.2}", v)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn counts_get_thousands_separators() {
        assert_eq!(count(0), "0");
        assert_eq!(count(999), "999");
        assert_eq!(count(1000), "1,000");
        assert_eq!(count(4689), "4,689");
        assert_eq!(count(1234567), "1,234,567");
    }

    #[test]
    fn sizes_and_durations_read_naturally() {
        assert_eq!(bytes(512), "512 B");
        assert_eq!(bytes(14_200), "14.2 KB");
        assert_eq!(bytes(268_000_000), "268 MB");
        assert_eq!(bytes(1_410_000_000), "1.41 GB");
        assert_eq!(bytes(999_999), "1.00 MB");
        assert_eq!(duration(Duration::from_micros(850)), "850 µs");
        assert_eq!(duration(Duration::from_micros(129_400)), "129 ms");
        assert_eq!(duration(Duration::from_millis(1240)), "1.24 s");
        assert_eq!(duration(Duration::from_secs(125)), "2m 05s");
    }
}
