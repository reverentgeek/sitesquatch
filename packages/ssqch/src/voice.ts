// The lines with a Sasquatch in them.
//
// ssqch reports like a deadpan park ranger: what happened comes first, and now and then
// something large walks through the log. The rules (also in `AGENTS.md`): a themed line still
// names the file and what went wrong, and keeps the words people search for; `--format json`,
// diagnostic codes and exit codes stay plain; nothing is random; and a build never adds anything
// of its own to a site's output.
//
// The lines more than one place uses (or a test names) are here.

/** The dev server's name, after the line that says where it serves. */
export const SQUATCH_WATCH = "Squatch Watch is on.";

/** A source file changed while serving: `Fresh tracks in src/posts/hello.md`. */
export const FRESH_TRACKS = "Fresh tracks in";

/** A site's first build, in front of `Built in ...`. */
export const FIRST_SIGHTING = "First confirmed sighting.";

/** While serving, a build that works after one that failed, in front of `Built in ...`. */
export const RECOVERED = "Build recovered. Back on the trail.";

/** After `ssqch new` says which page it created, and from what. */
// DELIBERATE (0.15): it says what to do next, on any site (the owner, 2026-11-24: "Field notes
// started." was the blog starter's line, odd on a careers page an office manager fills in).
export const FIELD_NOTES = "Fresh tracks: fill in its fields, then build.";

/** After the stale files `leaveNoTrace` removed. */
export const LEFT_NO_TRACE = "left no trace";

/** While serving, something else (another build into the output folder) deleted a stylesheet or script, in front of which ones. */
export const CAMPSITE_DISTURBED = "Campsite disturbed:";

/** A layout, include or component that leads back to itself. The names of the loop follow it. */
export const PASSED_THIS_TREE = "we've passed this tree before";

/** Builds made the same way that came out different, in front of how many files vary (`ssqch diff` with three builds, and `ssqch baseline`). */
export const ACCOUNTS_DIFFER = "The eyewitness accounts differ:";

/** A link that leads nowhere. */
export const TRAIL_GOES_COLD = "the trail goes cold";

/** An error that isn't the site's: a bug in ssqch, in front of what it was doing. */
export const SOMETHING_LARGE = "something large walked through the build";

/** Where to report a bug in ssqch. */
export const ISSUES_URL = "https://github.com/reverentgeek/sitesquatch/issues";
