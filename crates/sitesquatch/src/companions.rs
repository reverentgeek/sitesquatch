//! Companion processes: the programs `serve.run` lists, which `ssqch serve`
//! starts with the server and stops with it. They're for tools that watch and
//! write files of their own, like PostCSS, Tailwind or esbuild with `--watch`,
//! so one command serves a site that has its own CSS and JavaScript tools.
//!
//! Each runs through the shell in the project root, with the same `SSQCH_*`
//! variables as a `beforeBuild` command, in a process group of its own (a
//! job tree on Windows), so stopping it also stops what it started (`npx`
//! starts the tool as another process). Each line it prints is shown with the
//! tool's name in front: `[postcss] Finished in 120 ms`.

use std::io::{BufRead, BufReader};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use anyhow::Result;

use crate::config::BuildContext;

/// The process groups running now, for the Ctrl-C handler.
static RUNNING: Mutex<Vec<u32>> = Mutex::new(Vec::new());
/// Set when ssqch is stopping, so a companion stopping with it isn't news.
static SHUTTING_DOWN: AtomicBool = AtomicBool::new(false);

/// The companions of one configuration. Dropping it stops them.
pub struct Companions {
    commands: Vec<String>,
    running: Vec<Running>,
}

struct Running {
    pid: u32,
    stopping: Arc<AtomicBool>,
    /// Held open: Tailwind's and esbuild's `--watch` stop when their standard
    /// input closes, which a null one does at once.
    stdin: Option<std::process::ChildStdin>,
}

impl Companions {
    /// No companions.
    pub fn none() -> Self {
        Companions { commands: Vec::new(), running: Vec::new() }
    }

    /// Start `commands`. One that can't start is an error naming it (the ones
    /// before it are stopped again).
    pub fn start(ctx: &BuildContext, commands: &[String]) -> Result<Self> {
        let mut companions = Companions { commands: commands.to_vec(), running: Vec::new() };
        if commands.is_empty() {
            return Ok(companions);
        }
        install_handler();
        for command in commands {
            let name = tool_name(command);
            crate::diagnostics::progress(&format!("[ssqch] serve.run: {}", command));
            let mut child = shell(command)
                .current_dir(&ctx.root)
                .env("SSQCH_ENV", ctx.env.as_str())
                .env("SSQCH_SERVING", "true")
                .env("SSQCH_INPUT", &ctx.input_dir)
                .env("SSQCH_OUTPUT", &ctx.output_dir)
                .stdin(Stdio::piped())
                .stdout(Stdio::piped())
                .stderr(Stdio::piped())
                .spawn()
                .map_err(|e| anyhow::anyhow!("serve.run: couldn't run `{}`: {}", command, e))?;
            let pid = child.id();
            let stdin = child.stdin.take();
            RUNNING.lock().unwrap().push(pid);
            if let Some(out) = child.stdout.take() {
                let name = name.clone();
                std::thread::spawn(move || relay(out, &name, false));
            }
            if let Some(err) = child.stderr.take() {
                let name = name.clone();
                std::thread::spawn(move || relay(err, &name, true));
            }
            let stopping = Arc::new(AtomicBool::new(false));
            let flag = stopping.clone();
            let shown = command.clone();
            std::thread::spawn(move || wait(child, &shown, &flag));
            companions.running.push(Running { pid, stopping, stdin });
        }
        Ok(companions)
    }

    /// Whether these are the companions `commands` would start.
    pub fn runs(&self, commands: &[String]) -> bool {
        self.commands == commands
    }

    /// The tools' names (`postcss`, `esbuild`), for messages about a file one of them should have written.
    pub fn names(&self) -> Vec<String> {
        self.commands.iter().map(|c| tool_name(c)).collect()
    }
}

impl Drop for Companions {
    fn drop(&mut self) {
        for running in &mut self.running {
            running.stopping.store(true, Ordering::SeqCst);
            // Closing standard input is the polite way to stop a watcher; the signal follows.
            drop(running.stdin.take());
            stop(running.pid);
        }
        RUNNING.lock().unwrap().retain(|pid| !self.running.iter().any(|r| r.pid == *pid));
    }
}

/// `sh -c command` (`cmd /C` on Windows), in a process group of its own.
fn shell(command: &str) -> Command {
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        let mut c = Command::new("sh");
        c.arg("-c").arg(command).process_group(0);
        c
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NEW_PROCESS_GROUP: u32 = 0x0000_0200;
        let mut c = Command::new("cmd");
        c.arg("/C").arg(command).creation_flags(CREATE_NEW_PROCESS_GROUP);
        c
    }
}

/// Stop the process group (or tree) that `pid` leads.
fn stop(pid: u32) {
    #[cfg(unix)]
    {
        let group = -(pid as i32);
        // SAFETY: kill only sends a signal; a group that's gone already is ESRCH, which is fine.
        unsafe { libc::kill(group, libc::SIGTERM) };
        // A tool that ignores SIGTERM gets a moment, then SIGKILL.
        for _ in 0..20 {
            // SAFETY: signal 0 only checks that the group still exists.
            if unsafe { libc::kill(group, 0) } != 0 {
                return;
            }
            std::thread::sleep(std::time::Duration::from_millis(50));
        }
        // SAFETY: as above.
        unsafe { libc::kill(group, libc::SIGKILL) };
    }
    #[cfg(windows)]
    {
        let _ = Command::new("taskkill").args(["/PID", &pid.to_string(), "/T", "/F"]).stdout(Stdio::null()).stderr(Stdio::null()).status();
    }
}

/// Show each line from `stream` with `[name]` in front.
fn relay(stream: impl std::io::Read, name: &str, error: bool) {
    for line in BufReader::new(stream).lines() {
        let Ok(line) = line else { break };
        let line = format!("[{}] {}", name, line.trim_end());
        if error {
            eprintln!("{}", line);
        } else {
            crate::diagnostics::progress(&line);
        }
    }
}

/// Wait for a companion, and say so if it stops while the server is still up.
fn wait(mut child: Child, command: &str, stopping: &AtomicBool) {
    let status = child.wait();
    if stopping.load(Ordering::SeqCst) || SHUTTING_DOWN.load(Ordering::SeqCst) {
        return;
    }
    let how = match status {
        Ok(s) if s.success() => "finished".to_string(),
        Ok(s) => s.code().map(|c| format!("exited with status {}", c)).unwrap_or_else(|| "was stopped".into()),
        Err(e) => format!("couldn't be waited for ({})", e),
    };
    eprintln!("warn: serve.run: `{}` {}. The server keeps going without it; save ssqch.config.js to start it again.", command, how);
}

/// Stop the companions on Ctrl-C (and on SIGTERM or SIGHUP), then exit.
/// Without companions, ssqch keeps the default handling.
fn install_handler() {
    static INSTALLED: AtomicBool = AtomicBool::new(false);
    if INSTALLED.swap(true, Ordering::SeqCst) {
        return;
    }
    let _ = ctrlc::set_handler(|| {
        SHUTTING_DOWN.store(true, Ordering::SeqCst);
        let pids: Vec<u32> = RUNNING.lock().unwrap().drain(..).collect();
        for pid in pids {
            stop(pid);
        }
        std::process::exit(130);
    });
}

/// The name a command's output is shown under: the tool it runs, past
/// `npx`, `pnpm exec` and the like, without a scope or a path
/// (`npx @tailwindcss/cli -i ...` is `tailwindcss`).
pub fn tool_name(command: &str) -> String {
    const RUNNERS: &[&str] = &["npx", "pnpx", "bunx", "pnpm", "yarn", "npm", "bun", "deno", "node", "exec", "run", "dlx", "x", "env"];
    let word = command.split_whitespace().find(|w| !RUNNERS.contains(w) && !w.starts_with('-') && !w.contains('=')).unwrap_or("run");
    let word = word.trim_matches(['"', '\'']);
    let word = match word.strip_prefix('@') {
        Some(scoped) => scoped.split('/').next().unwrap_or(scoped),
        None => word.rsplit(['/', '\\']).next().unwrap_or(word),
    };
    let word = word.split('@').next().unwrap_or(word);
    let word = word.strip_suffix(".js").or_else(|| word.strip_suffix(".mjs")).unwrap_or(word);
    if word.is_empty() { "run".into() } else { word.to_string() }
}

#[cfg(test)]
mod tests {
    use super::tool_name;

    #[test]
    fn a_command_is_named_after_its_tool() {
        for (command, name) in [
            ("npx postcss src/assets/css/index.css -o dist/assets/index.css --watch", "postcss"),
            ("npx @tailwindcss/cli -i src/app.css -o dist/app.css --watch", "tailwindcss"),
            ("pnpm exec esbuild src/app.js --bundle --watch", "esbuild"),
            ("node scripts/watch-icons.mjs", "watch-icons"),
            ("NODE_ENV=development npx tsc --watch", "tsc"),
            ("bunx sass@1.80 src/main.scss dist/main.css --watch", "sass"),
            ("./bin/watch", "watch"),
        ] {
            assert_eq!(tool_name(command), name, "{}", command);
        }
    }
}
