//! ssqch's own Markdown and highlighter, for the Node build (0.8).
//!
//! [`markdown`], [`syntax`] (0.7's `highlight.rs`), [`suggest`] and [`value`] (from
//! `sitesquatch-edge`) are 0.7's, moved here unchanged when the Rust implementation was removed,
//! so a `.md` page comes out as 0.7 wrote it. The other modules stand in for the rest of the
//! `sitesquatch` crate they used, and [`wasm`] is how Node calls them: built for
//! `wasm32-wasip1`, this crate is `packages/ssqch/wasm/markdown.wasm`, which
//! `packages/ssqch/src/engines/markdown.ts` loads. The interface between the two is private to
//! ssqch (it isn't the plugin ABI), so it can change with them.
//!
//! What Node gives the wasm: the `markdown` options (checked by Node already), the site's render
//! hooks by name, and its functions (`headingIds: text => id`, highlighters in
//! `markdown.highlight.languages`) as numbers it calls back with. What the wasm gives back:
//! HTML, errors as text, and warnings with their codes.
//!
//! Natively the crate builds for `cargo test` and clippy, without the wasm exports.

pub use value::{Map, Value};

// What the Node build doesn't call (0.7's `set_current`, `html_text`) is left as it is.
#[allow(dead_code)]
pub mod markdown;

/// 0.7's highlighter as it is. [`highlight`] wraps it with a cache, and is the `highlight`
/// module `markdown.rs` calls.
#[cfg(feature = "highlight")]
pub mod syntax;

#[cfg(feature = "highlight")]
pub mod highlight;

pub mod suggest;

/// 0.7's Edge value (`sitesquatch-edge`'s `value.rs`), the type `markdown.rs` passes around. What
/// the Node build doesn't use of it (functions, the template engine's conversions) is left as it is.
#[allow(dead_code)]
pub mod value;

pub mod diagnostics;
pub mod json;
pub mod options;

// The wasm is always built with the highlighter.
#[cfg(all(target_arch = "wasm32", feature = "highlight"))]
pub mod wasm;
