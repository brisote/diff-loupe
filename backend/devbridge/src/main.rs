use clap::Parser;
use diffloupe_core::platform::Platform;
use diffloupe_core::shellenv::ShellEnv;
use diffloupe_devbridge::{Bridge, serve};
use serde_json::json;
use std::path::PathBuf;
use std::process::ExitCode;
use tokio::net::TcpListener;

#[derive(Parser)]
#[command(about = "Serves the Diffloupe core over a local WebSocket, so the UI runs in a browser")]
struct Args {
    #[arg(long, default_value_t = 7357)]
    port: u16,
    #[arg(long)]
    data_dir: PathBuf,
    #[arg(long)]
    open: Vec<PathBuf>,
    #[arg(long)]
    pick: Option<PathBuf>,
    #[arg(long, value_parser = platform_name, default_value = Platform::CURRENT.name())]
    platform: Platform,
}

fn platform_name(name: &str) -> Result<Platform, String> {
    Platform::parse(name).ok_or_else(|| format!("{name} is not macos, windows or linux"))
}

#[tokio::main]
async fn main() -> ExitCode {
    match run(Args::parse()).await {
        Ok(()) => ExitCode::SUCCESS,
        Err(message) => {
            eprintln!("{message}");
            ExitCode::FAILURE
        }
    }
}

async fn run(args: Args) -> Result<(), String> {
    std::fs::create_dir_all(&args.data_dir).map_err(|e| e.to_string())?;
    let pick = args.pick.map(|p| p.display().to_string());
    let bridge = Bridge::start(&args.data_dir, ShellEnv::detect(), pick, args.platform)
        .map_err(|e| e.to_string())?;
    for path in &args.open {
        bridge
            .core()
            .dispatch("open_repo", json!({ "path": path }))
            .map_err(|e| e.message)?;
    }
    let listener = TcpListener::bind(("127.0.0.1", args.port))
        .await
        .map_err(|e| e.to_string())?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    println!("Diffloupe dev bridge ready on ws://127.0.0.1:{port}");
    serve(listener, bridge).await;
    Ok(())
}
