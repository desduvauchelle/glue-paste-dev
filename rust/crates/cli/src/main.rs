use clap::{Parser, Subcommand};

#[derive(Parser)]
#[command(name = "glue-paste-dev", version, about = "GluePaste CLI")]
struct Cli {
    #[command(subcommand)]
    command: Command,
}

#[derive(Subcommand)]
enum Command {
    /// Show daemon status
    Status,
    /// Open dashboard in default browser
    Open,
    /// Add a card from the command line
    Add {
        /// Card title
        title: String,
        /// Project board name or slug
        #[arg(short = 'p', long)]
        project: String,
        /// Card description (optional)
        #[arg(short = 'd', long, default_value = "")]
        description: String,
    },
    /// Stop the daemon (GluePaste app)
    Stop,
    /// Uninstall (placeholder — full impl in Phase 6)
    Uninstall {
        #[arg(long)]
        keep_data: bool,
    },
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let cli = Cli::parse();
    match cli.command {
        Command::Status => cmd_status().await?,
        Command::Open => cmd_open()?,
        Command::Add { title, project, description } => cmd_add(title, project, description).await?,
        Command::Stop => cmd_stop()?,
        Command::Uninstall { keep_data } => cmd_uninstall(keep_data)?,
    }
    Ok(())
}

const PORT: u16 = 4242;

async fn cmd_status() -> Result<(), Box<dyn std::error::Error>> {
    let url = format!("http://localhost:{PORT}/api/boards");
    match reqwest::Client::new().get(&url).timeout(std::time::Duration::from_secs(2)).send().await {
        Ok(res) if res.status().is_success() => {
            let boards: serde_json::Value = res.json().await?;
            let count = boards.as_array().map(|a| a.len()).unwrap_or(0);
            println!("GluePaste daemon: running");
            println!("Endpoint: http://localhost:{PORT}");
            println!("Boards: {count}");
        }
        _ => {
            println!("GluePaste daemon: not running");
            println!("Start the GluePaste app to launch the daemon.");
        }
    }
    Ok(())
}

fn cmd_open() -> Result<(), Box<dyn std::error::Error>> {
    let url = format!("http://localhost:{PORT}");
    #[cfg(target_os = "macos")]
    std::process::Command::new("open").arg(&url).spawn()?.wait()?;
    #[cfg(target_os = "linux")]
    std::process::Command::new("xdg-open").arg(&url).spawn()?.wait()?;
    #[cfg(target_os = "windows")]
    std::process::Command::new("cmd").args(["/C", "start", &url]).spawn()?.wait()?;
    Ok(())
}

async fn cmd_add(title: String, project: String, description: String) -> Result<(), Box<dyn std::error::Error>> {
    // Look up board by name or slug via REST
    let boards: Vec<serde_json::Value> = reqwest::Client::new()
        .get(format!("http://localhost:{PORT}/api/boards"))
        .send().await?.json().await?;
    let board = boards.iter().find(|b| {
        b["name"].as_str() == Some(&project) || b["slug"].as_str() == Some(&project)
    }).ok_or_else(|| format!("no board matching '{project}'"))?;
    let board_id = board["id"].as_str().ok_or("board missing id")?.to_string();

    // POST to /api/cards/<board_id>
    let body = serde_json::json!({
        "title": title,
        "description": description,
        "tags": [],
        "files": [],
    });
    let res = reqwest::Client::new()
        .post(format!("http://localhost:{PORT}/api/cards/{board_id}"))
        .json(&body).send().await?;
    if res.status().is_success() {
        println!("✓ Added '{title}' to {}", board["name"]);
    } else {
        eprintln!("Failed: HTTP {}", res.status());
        std::process::exit(1);
    }
    Ok(())
}

fn cmd_stop() -> Result<(), Box<dyn std::error::Error>> {
    // macOS: quit the GluePaste app via osascript
    #[cfg(target_os = "macos")]
    {
        let status = std::process::Command::new("osascript")
            .args(["-e", "quit app \"GluePaste\""])
            .status()?;
        if status.success() {
            println!("Sent quit to GluePaste");
        } else {
            println!("App may not be running");
        }
    }
    #[cfg(not(target_os = "macos"))]
    println!("Stop only supported on macOS today");
    Ok(())
}

fn cmd_uninstall(keep_data: bool) -> Result<(), Box<dyn std::error::Error>> {
    println!("Uninstall (placeholder — Phase 6 implements):");
    println!("  - Remove /Applications/GluePaste.app");
    println!("  - {} ~/.glue-paste-dev/", if keep_data { "Keep data dir" } else { "Remove data dir" });
    Ok(())
}
