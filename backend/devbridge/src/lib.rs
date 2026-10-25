use diffloupe_core::Core;
use diffloupe_core::events::{CoreEvent, EventSink};
use diffloupe_core::platform::Platform;
use diffloupe_core::shellenv::ShellEnv;
use futures_util::{SinkExt, StreamExt};
use serde::Deserialize;
use serde_json::{Value, json};
use std::collections::HashMap;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::{broadcast, mpsc};
use tokio_tungstenite::tungstenite::Message;
use tokio_tungstenite::tungstenite::handshake::server::{
    ErrorResponse, Request as Handshake, Response,
};
use tokio_tungstenite::tungstenite::http::StatusCode;

pub struct Bridge {
    core: Core,
    pick: Mutex<Option<String>>,
    uninstalled: AtomicBool,
    installed: Mutex<Option<String>>,
    failures: Mutex<HashMap<String, Value>>,
    opened: Mutex<Vec<String>>,
    push: broadcast::Sender<String>,
}

#[derive(Deserialize)]
struct Request {
    id: u64,
    cmd: String,
    #[serde(default)]
    args: Value,
}

struct Broadcast(broadcast::Sender<String>);

impl EventSink for Broadcast {
    fn emit(&self, event: CoreEvent) {
        let _ = self.0.send(json!({ "event": event }).to_string());
    }
}

impl Bridge {
    pub fn start(
        data_dir: &Path,
        env: ShellEnv,
        pick: Option<String>,
        platform: Platform,
    ) -> diffloupe_core::error::Result<Arc<Bridge>> {
        let (push, _) = broadcast::channel(4096);
        let core = Core::for_platform(data_dir, env, Arc::new(Broadcast(push.clone())), platform)?;
        Ok(Arc::new(Bridge {
            core,
            pick: Mutex::new(pick),
            uninstalled: AtomicBool::new(false),
            installed: Mutex::new(None),
            failures: Mutex::new(HashMap::new()),
            opened: Mutex::new(Vec::new()),
            push,
        }))
    }

    pub fn core(&self) -> &Core {
        &self.core
    }

    fn handle(&self, cmd: &str, args: Value) -> Result<Value, Value> {
        if let Some(failure) = self
            .failures
            .lock()
            .ok()
            .and_then(|mut failures| failures.remove(cmd))
        {
            return Err(failure);
        }
        match cmd {
            "devbridge_fail_next" => {
                let Some(command) = args.get("command").and_then(Value::as_str) else {
                    return Err(json!({
                        "code": "invalidArgs",
                        "message": "devbridge_fail_next needs a command",
                        "path": Value::Null,
                    }));
                };
                let error = json!({
                    "code": args.get("code").cloned().unwrap_or(json!("store")),
                    "message": args.get("message").cloned().unwrap_or(json!("storage failed")),
                    "path": Value::Null,
                });
                if let Ok(mut failures) = self.failures.lock() {
                    failures.insert(command.to_string(), error);
                }
                Ok(Value::Null)
            }
            "pick_folder" => Ok(self
                .pick
                .lock()
                .map(|pick| json!(*pick))
                .unwrap_or(Value::Null)),
            "devbridge_set_pick" => {
                let path = args.get("path").and_then(Value::as_str).map(str::to_string);
                if let Ok(mut pick) = self.pick.lock() {
                    *pick = path;
                }
                Ok(Value::Null)
            }
            "uninstall" => {
                self.uninstalled.store(true, Ordering::SeqCst);
                Ok(Value::Null)
            }
            "devbridge_uninstalled" => Ok(json!(self.uninstalled.load(Ordering::SeqCst))),
            "install_update" => {
                let image = self.core.update_ready().ok_or_else(
                    || json!({ "code": "update", "message": "No downloaded update is ready to install." }),
                )?;
                if let Ok(mut installed) = self.installed.lock() {
                    *installed = Some(image.display().to_string());
                }
                Ok(Value::Null)
            }
            "devbridge_update_installed" => Ok(self
                .installed
                .lock()
                .map(|installed| json!(*installed))
                .unwrap_or(Value::Null)),
            "open_link" => {
                let url = args.get("url").and_then(Value::as_str).unwrap_or_default();
                let url = diffloupe_core::update::link(url)
                    .map_err(|e| json!({ "code": e.code(), "message": e.to_string() }))?;
                if let Ok(mut opened) = self.opened.lock() {
                    opened.push(url.to_string());
                }
                Ok(Value::Null)
            }
            "devbridge_opened" => Ok(self
                .opened
                .lock()
                .map(|opened| json!(*opened))
                .unwrap_or(Value::Null)),
            "devbridge_drop" => {
                let path = args.get("path").cloned().unwrap_or(Value::Null);
                let _ = self.push.send(json!({ "drop": path }).to_string());
                Ok(Value::Null)
            }
            _ => self.core.dispatch(cmd, args).map_err(|error| json!(error)),
        }
    }
}

pub fn local_origin(origin: Option<&str>) -> bool {
    let Some(origin) = origin else {
        return true;
    };
    ["http://localhost:", "http://127.0.0.1:"]
        .iter()
        .any(|prefix| {
            origin
                .strip_prefix(prefix)
                .is_some_and(|port| port.parse::<u16>().is_ok())
        })
}

#[allow(clippy::result_large_err)]
fn check_origin(request: &Handshake, response: Response) -> Result<Response, ErrorResponse> {
    let origin = request
        .headers()
        .get("origin")
        .and_then(|value| value.to_str().ok());
    if local_origin(origin) {
        return Ok(response);
    }
    let mut refusal = ErrorResponse::new(Some("only local pages may use the dev bridge".into()));
    *refusal.status_mut() = StatusCode::FORBIDDEN;
    Err(refusal)
}

pub async fn serve(listener: TcpListener, bridge: Arc<Bridge>) {
    while let Ok((stream, _)) = listener.accept().await {
        tokio::spawn(connection(stream, bridge.clone()));
    }
}

async fn connection(stream: TcpStream, bridge: Arc<Bridge>) {
    let Ok(socket) = tokio_tungstenite::accept_hdr_async(stream, check_origin).await else {
        return;
    };
    let (mut sink, mut source) = socket.split();
    let (replies, mut outgoing) = mpsc::unbounded_channel::<String>();
    let mut pushes = bridge.push.subscribe();
    let writer = tokio::spawn(async move {
        loop {
            let text = tokio::select! {
                Some(text) = outgoing.recv() => text,
                pushed = pushes.recv() => match pushed {
                    Ok(text) => text,
                    Err(broadcast::error::RecvError::Lagged(_)) => continue,
                    Err(broadcast::error::RecvError::Closed) => break,
                },
                else => break,
            };
            if sink.send(Message::text(text)).await.is_err() {
                break;
            }
        }
    });
    while let Some(Ok(message)) = source.next().await {
        let Message::Text(text) = message else {
            continue;
        };
        let Ok(request) = serde_json::from_str::<Request>(text.as_str()) else {
            continue;
        };
        let bridge = bridge.clone();
        let replies = replies.clone();
        tokio::task::spawn_blocking(move || {
            let reply = match bridge.handle(&request.cmd, request.args) {
                Ok(value) => json!({ "id": request.id, "ok": value }),
                Err(error) => json!({ "id": request.id, "error": error }),
            };
            let _ = replies.send(reply.to_string());
        });
    }
    writer.abort();
}

#[cfg(test)]
mod tests {
    use super::local_origin;

    #[test]
    fn only_local_pages_and_non_browser_clients_are_accepted() {
        assert!(local_origin(None));
        assert!(local_origin(Some("http://localhost:1420")));
        assert!(local_origin(Some("http://127.0.0.1:1421")));
        assert!(!local_origin(Some("https://example.com")));
        assert!(!local_origin(Some("http://localhost.example.com:80")));
        assert!(!local_origin(Some("http://localhost:1420.example.com")));
        assert!(!local_origin(Some("null")));
    }
}
