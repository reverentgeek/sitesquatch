//! "Did you mean": the closest of the names something could have meant.
//!
//! A name is close when a few edits (a letter added, dropped or changed)
//! turn one into the other. Used for schema fields, config and plugin
//! options, layouts, includes, links and the dev server's 404 page.

/// The candidate within two edits of `key`, for short names (a field, an
/// option, a file).
pub fn closest<'a>(key: &str, candidates: impl Iterator<Item = &'a str>) -> Option<&'a str> {
    candidates.map(|c| (edit_distance(key, c), c)).filter(|(d, c)| *d <= 2 && *d < c.len()).min_by_key(|(d, _)| *d).map(|(_, c)| c)
}

/// The candidate closest to `wanted`, for URL paths: within three edits, and
/// no more than a third of the candidate (so `/a/` isn't close to `/b/`). A
/// trailing slash on either doesn't count.
pub fn closest_path<'a>(wanted: &str, candidates: impl Iterator<Item = &'a str>) -> Option<&'a str> {
    let wanted = wanted.trim_end_matches('/');
    let length = wanted.chars().count();
    candidates
        .filter_map(|c| {
            let trimmed = c.trim_end_matches('/');
            let candidate_length = trimmed.chars().count();
            // Too different in length to be within three edits: not worth comparing.
            if candidate_length.abs_diff(length) > 3 || trimmed == wanted {
                return None;
            }
            Some(edit_distance(wanted, trimmed)).filter(|d| *d <= 3 && *d * 3 <= candidate_length).map(|d| (d, c))
        })
        .min_by_key(|(d, _)| *d)
        .map(|(_, c)| c)
}

/// The number of single-character edits between `a` and `b`, ignoring case.
pub fn edit_distance(a: &str, b: &str) -> usize {
    let (a, b): (Vec<char>, Vec<char>) = (a.to_lowercase().chars().collect(), b.to_lowercase().chars().collect());
    let mut row: Vec<usize> = (0..=b.len()).collect();
    for (i, ca) in a.iter().enumerate() {
        let mut previous = row[0];
        row[0] = i + 1;
        for (j, cb) in b.iter().enumerate() {
            let current = row[j + 1];
            row[j + 1] = if ca == cb { previous } else { 1 + previous.min(current).min(row[j]) };
            previous = current;
        }
    }
    row[b.len()]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_closest_name_is_a_few_edits_away() {
        assert_eq!(closest("descripton", ["title", "description"].into_iter()), Some("description"));
        assert_eq!(closest("ouput", ["input", "output"].into_iter()), Some("output"));
        assert_eq!(closest("colour", ["title", "date"].into_iter()), None);
        // A short name isn't "close" to every other short name.
        assert_eq!(closest("a", ["b", "c"].into_iter()), None);

        let pages = ["/", "/contact/", "/about/", "/posts/pine-cone-crunch/"];
        assert_eq!(closest_path("/contactt/", pages.into_iter()), Some("/contact/"));
        assert_eq!(closest_path("/contact", pages.into_iter()), None, "the same but for the slash isn't a suggestion");
        assert_eq!(closest_path("/posts/pinecone-crunch/", pages.into_iter()), Some("/posts/pine-cone-crunch/"));
        assert_eq!(closest_path("/nope/", pages.into_iter()), None);
        assert_eq!(closest_path("/x/", ["/a/", "/b/"].into_iter()), None);
    }
}
