//! The `ssqch` binary's command line.

use std::process::Command;

#[test]
fn version_names_the_binary() {
    let out = Command::new(env!("CARGO_BIN_EXE_ssqch")).arg("--version").output().unwrap();
    assert!(out.status.success());
    assert_eq!(String::from_utf8_lossy(&out.stdout), format!("ssqch {}\n", env!("CARGO_PKG_VERSION")));
}
