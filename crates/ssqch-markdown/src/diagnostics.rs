//! The part of 0.7's `diagnostics` that `highlight.rs` uses: a warning with its code and the
//! page it's about. In the wasm, [`warn`] hands it to Node, which reports it as the build's own
//! (printed, or kept for `--format json`). Natively it's kept for [`take`], for tests.

pub struct Diagnostic {
    pub code: String,
    pub message: String,
    /// From the project root, with forward slashes.
    pub file: Option<String>,
}

impl Diagnostic {
    pub fn warning(code: &str, message: impl Into<String>) -> Self {
        Diagnostic { code: code.into(), message: message.into(), file: None }
    }

    pub fn file(mut self, file: impl Into<String>) -> Self {
        self.file = Some(file.into().replace('\\', "/").trim_start_matches("./").to_string());
        self
    }
}

#[cfg(all(target_arch = "wasm32", feature = "highlight"))]
pub fn warn(diagnostic: Diagnostic) {
    crate::wasm::warn(&diagnostic);
}

#[cfg(not(all(target_arch = "wasm32", feature = "highlight")))]
thread_local! {
    static WARNINGS: std::cell::RefCell<Vec<Diagnostic>> = const { std::cell::RefCell::new(Vec::new()) };
}

#[cfg(not(all(target_arch = "wasm32", feature = "highlight")))]
pub fn warn(diagnostic: Diagnostic) {
    WARNINGS.with(|w| w.borrow_mut().push(diagnostic));
}

/// The warnings so far on this thread.
#[cfg(not(all(target_arch = "wasm32", feature = "highlight")))]
pub fn take() -> Vec<Diagnostic> {
    WARNINGS.with(|w| std::mem::take(&mut *w.borrow_mut()))
}
