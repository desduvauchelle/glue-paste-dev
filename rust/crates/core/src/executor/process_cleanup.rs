/// Kills a process and its descendants synchronously.
/// Returns silently on any error (process may already be dead).
pub fn kill_process_tree(pid: i32) {
    if pid <= 0 {
        return;
    }

    #[cfg(unix)]
    {
        use std::thread;
        use std::time::Duration;

        let pid_str = pid.to_string();

        // Kill children with SIGTERM (pkill -TERM -P <pid>)
        run_silent("pkill", &["-TERM", "-P", &pid_str]);
        // Kill the process itself with SIGTERM via /bin/kill (avoids shell built-in lookup)
        run_silent("/bin/kill", &["-TERM", &pid_str]);

        thread::sleep(Duration::from_millis(500));

        // Force-kill remaining children
        run_silent("pkill", &["-9", "-P", &pid_str]);
        // Force-kill the process itself
        run_silent("/bin/kill", &["-KILL", &pid_str]);
    }

    #[cfg(windows)]
    {
        let pid_str = pid.to_string();
        // /T = tree-kill, /F = force
        run_silent("taskkill", &["/T", "/F", "/PID", &pid_str]);
    }
}

fn run_silent(program: &str, args: &[&str]) {
    let _ = std::process::Command::new(program)
        .args(args)
        .output();
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(unix)]
    #[test]
    fn noop_on_negative_pid() {
        kill_process_tree(0);
        kill_process_tree(-1);
        // No panic; nothing to verify directly
    }

    #[cfg(unix)]
    #[test]
    fn kills_a_child_process() {
        use std::process::{Command, Stdio};

        let mut child = Command::new("sh")
            .args(["-c", "sleep 30"])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .expect("spawn sleep");
        let pid = child.id() as i32;

        // Confirm alive
        let alive = unsafe { libc::kill(pid, 0) == 0 };
        assert!(alive, "sleep should be alive before kill");

        kill_process_tree(pid);

        // Reap the zombie so the OS releases the process entry.
        // Without this, libc::kill(pid, 0) returns 0 on zombies.
        let _ = child.wait();

        // After wait(), ESRCH means truly gone.
        let still_alive = unsafe { libc::kill(pid, 0) == 0 };
        assert!(!still_alive, "sleep should be dead after kill_process_tree");
    }
}
