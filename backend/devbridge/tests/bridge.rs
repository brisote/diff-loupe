#![allow(clippy::unwrap_used)]

use diffloupe_core::testutil::{TempRepo, test_env};
use diffloupe_devbridge::{Bridge, serve};
use futures_util::{SinkExt, StreamExt};
use serde_json::{Value, json};
use tokio::net::TcpListener;
use tokio_tungstenite::tungstenite::Message;

type Socket =
    tokio_tungstenite::WebSocketStream<tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>>;

async fn start(pick: Option<String>) -> (tempfile::TempDir, Socket) {
    let data = tempfile::tempdir().unwrap();
    let bridge = Bridge::start(data.path(), test_env(), pick).unwrap();
    let listener = TcpListener::bind(("127.0.0.1", 0)).await.unwrap();
    let port = listener.local_addr().unwrap().port();
    tokio::spawn(serve(listener, bridge));
    let (socket, _) = tokio_tungstenite::connect_async(format!("ws://127.0.0.1:{port}"))
        .await
        .unwrap();
    (data, socket)
}

async fn send(socket: &mut Socket, id: u64, cmd: &str, args: Value) {
    let text = json!({ "id": id, "cmd": cmd, "args": args }).to_string();
    socket.send(Message::text(text)).await.unwrap();
}

async fn next(socket: &mut Socket) -> Value {
    loop {
        if let Message::Text(text) = socket.next().await.unwrap().unwrap() {
            return serde_json::from_str(text.as_str()).unwrap();
        }
    }
}

async fn reply(socket: &mut Socket, id: u64) -> Value {
    loop {
        let message = next(socket).await;
        if message["id"] == id {
            return message;
        }
    }
}

#[tokio::test]
async fn commands_reach_the_core_and_events_are_pushed() {
    let repo = TempRepo::with_commit();
    let (_data, mut socket) = start(None).await;
    send(&mut socket, 1, "open_repo", json!({ "path": repo.path() })).await;
    let mut events = Vec::new();
    let answer = loop {
        let message = next(&mut socket).await;
        if message["id"] == 1 {
            break message;
        }
        events.push(message);
    };
    assert_eq!(answer["ok"]["name"], "acme-billing");
    assert_eq!(events[0]["event"]["type"], "task");
    assert_eq!(events[0]["event"]["label"], "Opening acme-billing");
}

#[tokio::test]
async fn errors_come_back_with_their_code() {
    let plain = tempfile::tempdir().unwrap();
    let (_data, mut socket) = start(None).await;
    send(&mut socket, 7, "open_repo", json!({ "path": plain.path() })).await;
    let answer = reply(&mut socket, 7).await;
    assert_eq!(answer["error"]["code"], "notARepository");
}

#[tokio::test]
async fn a_test_failure_hits_the_next_call_of_its_command_once() {
    let (_data, mut socket) = start(None).await;
    send(
        &mut socket,
        1,
        "devbridge_fail_next",
        json!({ "command": "recent_repos", "code": "store", "message": "storage failed" }),
    )
    .await;
    reply(&mut socket, 1).await;
    send(&mut socket, 2, "recent_repos", Value::Null).await;
    let failed = reply(&mut socket, 2).await;
    assert_eq!(failed["error"]["code"], "store");
    assert_eq!(failed["error"]["message"], "storage failed");
    send(&mut socket, 3, "recent_repos", Value::Null).await;
    assert!(reply(&mut socket, 3).await["ok"].is_array());
    send(&mut socket, 4, "devbridge_fail_next", json!({})).await;
    assert_eq!(reply(&mut socket, 4).await["error"]["code"], "invalidArgs");
}

#[tokio::test]
async fn the_folder_picker_returns_the_test_choice() {
    let (_data, mut socket) = start(Some("/tmp/first".into())).await;
    send(&mut socket, 1, "pick_folder", Value::Null).await;
    assert_eq!(reply(&mut socket, 1).await["ok"], "/tmp/first");
    send(
        &mut socket,
        2,
        "devbridge_set_pick",
        json!({ "path": null }),
    )
    .await;
    reply(&mut socket, 2).await;
    send(&mut socket, 3, "pick_folder", Value::Null).await;
    assert_eq!(reply(&mut socket, 3).await["ok"], Value::Null);
}

#[tokio::test]
async fn a_test_drop_is_pushed_to_the_page() {
    let (_data, mut socket) = start(None).await;
    send(
        &mut socket,
        1,
        "devbridge_drop",
        json!({ "path": "/tmp/dropped" }),
    )
    .await;
    let mut seen = Vec::new();
    while seen.len() < 2 {
        seen.push(next(&mut socket).await);
    }
    assert!(seen.iter().any(|m| m["drop"] == "/tmp/dropped"));
}

#[tokio::test]
async fn pages_from_other_sites_are_refused() {
    use tokio_tungstenite::tungstenite::client::IntoClientRequest;
    let data = tempfile::tempdir().unwrap();
    let bridge = Bridge::start(data.path(), test_env(), None).unwrap();
    let listener = TcpListener::bind(("127.0.0.1", 0)).await.unwrap();
    let port = listener.local_addr().unwrap().port();
    tokio::spawn(serve(listener, bridge));
    let mut request = format!("ws://127.0.0.1:{port}")
        .into_client_request()
        .unwrap();
    request
        .headers_mut()
        .insert("origin", "https://example.com".parse().unwrap());
    assert!(tokio_tungstenite::connect_async(request).await.is_err());
}
