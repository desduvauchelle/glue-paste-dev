use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::PathBuf;

fn executions_dir() -> PathBuf {
    if let Ok(override_dir) = std::env::var("GPD_EXECUTIONS_DIR") {
        return PathBuf::from(override_dir);
    }
    dirs::home_dir()
        .unwrap_or_default()
        .join(".glue-paste-dev")
        .join("executions")
}

pub fn execution_log_path(execution_id: &str) -> PathBuf {
    executions_dir().join(format!("{}.log", execution_id))
}

pub fn write_execution_log(execution_id: &str, line: &str) {
    let dir = executions_dir();
    let _ = fs::create_dir_all(&dir);
    let path = dir.join(format!("{}.log", execution_id));
    let timestamp = chrono::Utc::now()
        .to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
    let entry = format!("[{}] {}\n", timestamp, line);
    if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(&path) {
        let _ = file.write_all(entry.as_bytes());
    }
}

pub fn write_execution_log_raw(execution_id: &str, data: &str) {
    let dir = executions_dir();
    let _ = fs::create_dir_all(&dir);
    let path = dir.join(format!("{}.log", execution_id));
    if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(&path) {
        let _ = file.write_all(data.as_bytes());
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::sync::Mutex;

    static ENV_LOCK: Mutex<()> = Mutex::new(());

    #[test]
    fn execution_log_path_returns_correct_path() {
        let _guard = ENV_LOCK.lock().unwrap();
        let tmp = tempfile::tempdir().unwrap();
        std::env::set_var("GPD_EXECUTIONS_DIR", tmp.path());
        let result = execution_log_path("abc");
        std::env::remove_var("GPD_EXECUTIONS_DIR");
        assert_eq!(result, tmp.path().join("abc.log"));
    }

    #[test]
    fn write_execution_log_appends_line_with_timestamp() {
        let _guard = ENV_LOCK.lock().unwrap();
        let tmp = tempfile::tempdir().unwrap();
        std::env::set_var("GPD_EXECUTIONS_DIR", tmp.path());

        write_execution_log("test-exec", "first line");
        write_execution_log("test-exec", "second line");

        std::env::remove_var("GPD_EXECUTIONS_DIR");

        let content = fs::read_to_string(tmp.path().join("test-exec.log")).unwrap();
        let lines: Vec<&str> = content.lines().collect();
        assert_eq!(lines.len(), 2);
        assert!(lines[0].starts_with("[20"), "line 0 should start with timestamp: {}", lines[0]);
        assert!(lines[0].ends_with("first line"), "line 0 should end with input: {}", lines[0]);
        assert!(lines[1].starts_with("[20"), "line 1 should start with timestamp: {}", lines[1]);
        assert!(lines[1].ends_with("second line"), "line 1 should end with input: {}", lines[1]);
    }

    #[test]
    fn write_execution_log_raw_appends_no_timestamp() {
        let _guard = ENV_LOCK.lock().unwrap();
        let tmp = tempfile::tempdir().unwrap();
        std::env::set_var("GPD_EXECUTIONS_DIR", tmp.path());

        write_execution_log_raw("raw-exec", "chunk1");
        write_execution_log_raw("raw-exec", "chunk2");

        std::env::remove_var("GPD_EXECUTIONS_DIR");

        let content = fs::read_to_string(tmp.path().join("raw-exec.log")).unwrap();
        assert_eq!(content, "chunk1chunk2");
    }
}
