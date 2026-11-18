//! ssqch's own Markdown and highlighter, for the Node build (0.8).
//!
//! `markdown.rs`, `highlight.rs` and `suggest.rs` are 0.7's, from `crates/sitesquatch/src`,
//! compiled by path and unchanged, so a `.md` page comes out as 0.7 wrote it. The modules here
//! stand in for the rest of the `sitesquatch` crate they use, and [`wasm`] is how Node calls
//! them: built for `wasm32-wasip1`, this crate is `packages/ssqch/wasm/markdown.wasm`, which
//! `packages/ssqch/src/engines/markdown.ts` loads. The interface between the two is private to
//! ssqch (it isn't the plugin ABI), so it can change with them.
//!
//! What Node gives the wasm: the `markdown` options (checked by Node already), the site's render
//! hooks by name, and its functions (`headingIds: text => id`, highlighters in
//! `markdown.highlight.languages`) as numbers it calls back with. What the wasm gives back:
//! HTML, errors as text, and warnings with their codes.
//!
//! Natively the crate builds for `cargo test` and clippy, without the wasm exports.

pub use sitesquatch_edge::{Map, Value};

// What the Node build doesn't call (0.7's `set_current`, `html_text`) is left as it is.
#[allow(dead_code)]
#[path = "../../sitesquatch/src/markdown.rs"]
pub mod markdown;

/// 0.7's highlighter as it is. [`highlight`] wraps it with a cache, and is the `highlight`
/// module `markdown.rs` calls.
#[cfg(feature = "highlight")]
#[path = "../../sitesquatch/src/highlight.rs"]
pub mod syntax;

#[cfg(feature = "highlight")]
pub mod highlight;

#[path = "../../sitesquatch/src/suggest.rs"]
pub mod suggest;

pub mod diagnostics;
pub mod json;
pub mod options;

// The wasm is always built with the highlighter.
#[cfg(all(target_arch = "wasm32", feature = "highlight"))]
pub mod wasm;
