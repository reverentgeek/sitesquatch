//! The lines with a Sasquatch in them.
//!
//! ssqch reports like a deadpan park ranger: what happened comes first, and
//! now and then something large walks through the log. The rules (also in
//! `CLAUDE.md`): a themed line still names the file and what went wrong, and
//! keeps the words people search for; `--format json`, diagnostic codes and
//! exit codes stay plain; nothing is random; and a build never adds anything
//! of its own to a site's output.
//!
//! The lines more than one place uses (or a test names) are here.

/// The dev server's name, at the start of the line that says where it serves.
pub const SQUATCH_WATCH: &str = "Squatch Watch is on.";

/// A source file changed while serving: `Fresh tracks in src/posts/hello.md`.
pub const FRESH_TRACKS: &str = "Fresh tracks in";

/// A site's first build, in front of `Built in ...`.
pub const FIRST_SITING: &str = "First confirmed siting.";

/// After the stale files `leaveNoTrace` removed.
pub const LEFT_NO_TRACE: &str = "left no trace";

/// A layout, include or component that leads back to itself. The names of the
/// loop follow it.
pub const PASSED_THIS_TREE: &str = "we've passed this tree before";

/// A link that leads nowhere.
pub const TRAIL_GOES_COLD: &str = "the trail goes cold";

/// A panic inside the build, in front of what it was doing.
pub const SOMETHING_LARGE: &str = "something large walked through the build";

/// Where to report a bug in ssqch.
pub const ISSUES_URL: &str = "https://github.com/reverentgeek/sitesquatch/issues";
