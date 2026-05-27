use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};
use std::{
    collections::HashMap,
    io::{Read, Write},
    sync::{Arc, Mutex},
    thread,
};

/// Maximum bytes of recent output kept for scrollback replay.
const SCROLLBACK_MAX: usize = 256 * 1024;

pub struct PtySessionOptions {
    pub command: Vec<String>,
    pub cwd: String,
    pub env: HashMap<String, String>,
    pub cols: u16,
    pub rows: u16,
    /// Called with every decoded output chunk from the PTY.
    pub on_data: Box<dyn Fn(String) + Send + 'static>,
    /// Called once when the child exits.
    pub on_exit: Box<dyn Fn(i32) + Send + 'static>,
}

struct Inner {
    master: Box<dyn MasterPty + Send>,
    writer: Option<Box<dyn Write + Send>>,
    scrollback: String,
    running: bool,
    exit_code: Option<i32>,
    pid: Option<u32>,
}

/// Wraps a single interactive child process running under a portable PTY.
/// The child sees a real TTY, so CLIs render their interactive UI.
pub struct PtySession {
    inner: Arc<Mutex<Inner>>,
}

impl PtySession {
    pub fn new(opts: PtySessionOptions) -> Result<Self, String> {
        let pty_system = native_pty_system();
        let size = PtySize {
            rows: opts.rows,
            cols: opts.cols,
            pixel_width: 0,
            pixel_height: 0,
        };
        let pair = pty_system
            .openpty(size)
            .map_err(|e| format!("openpty failed: {e}"))?;

        // Take the writer before building the command (must happen before slave is consumed)
        let writer = pair
            .master
            .take_writer()
            .map_err(|e| format!("take_writer failed: {e}"))?;

        // Build the command
        let mut cmd = CommandBuilder::new(&opts.command[0]);
        for arg in opts.command.iter().skip(1) {
            cmd.arg(arg);
        }
        cmd.cwd(&opts.cwd);
        for (k, v) in &opts.env {
            cmd.env(k, v);
        }

        let mut child = pair
            .slave
            .spawn_command(cmd)
            .map_err(|e| format!("spawn failed: {e}"))?;
        let pid = child.process_id();

        // Clone the reader before we move master into Inner
        let reader = pair
            .master
            .try_clone_reader()
            .map_err(|e| format!("try_clone_reader failed: {e}"))?;

        let inner = Arc::new(Mutex::new(Inner {
            master: pair.master,
            writer: Some(writer),
            scrollback: String::new(),
            running: true,
            exit_code: None,
            pid,
        }));

        // Reader thread: drain PTY master output → on_data callback
        let inner_reader = Arc::clone(&inner);
        let on_data = opts.on_data;
        let on_exit = opts.on_exit;

        thread::spawn(move || {
            let mut reader = reader;
            let mut buf = [0u8; 4096];
            loop {
                match reader.read(&mut buf) {
                    Ok(0) | Err(_) => break,
                    Ok(n) => {
                        let text = String::from_utf8_lossy(&buf[..n]).into_owned();
                        {
                            let mut g = inner_reader.lock().unwrap();
                            g.scrollback.push_str(&text);
                            let len = g.scrollback.len();
                            if len > SCROLLBACK_MAX {
                                g.scrollback = g.scrollback[len - SCROLLBACK_MAX..].to_string();
                            }
                        }
                        on_data(text);
                    }
                }
            }

            // Child exited — collect exit status
            let code = child.wait().map(|s| s.exit_code() as i32).unwrap_or(-1);
            {
                let mut g = inner_reader.lock().unwrap();
                g.running = false;
                g.exit_code = Some(code);
                g.writer = None; // drop the writer so PTY is closed
            }
            on_exit(code);
        });

        Ok(Self { inner })
    }

    /// Write raw input (keystrokes / a prompt line ending in `\r`) to the PTY.
    pub fn write(&self, data: &str) {
        let mut g = self.inner.lock().unwrap();
        if !g.running {
            return;
        }
        if let Some(w) = g.writer.as_mut() {
            let _ = w.write_all(data.as_bytes());
        }
    }

    pub fn resize(&self, cols: u16, rows: u16) {
        let g = self.inner.lock().unwrap();
        if !g.running {
            return;
        }
        let _ = g.master.resize(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        });
    }

    pub fn get_scrollback(&self) -> String {
        self.inner.lock().unwrap().scrollback.clone()
    }

    pub fn is_running(&self) -> bool {
        self.inner.lock().unwrap().running
    }

    pub fn get_exit_code(&self) -> Option<i32> {
        self.inner.lock().unwrap().exit_code
    }

    pub fn pid(&self) -> Option<u32> {
        self.inner.lock().unwrap().pid
    }

    pub fn kill(&self) {
        let mut g = self.inner.lock().unwrap();
        if !g.running {
            return;
        }
        g.running = false;
        g.writer = None; // closing the writer causes slave to get EOF
        // SIGKILL the child process on Unix
        if let Some(pid) = g.pid {
            #[cfg(unix)]
            unsafe {
                libc::kill(pid as i32, libc::SIGKILL);
            }
        }
    }
}
