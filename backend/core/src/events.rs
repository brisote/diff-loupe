use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use ts_rs::TS;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(tag = "kind", rename_all = "camelCase")]
#[ts(export)]
pub enum AiStreamPayload {
    #[serde(rename_all = "camelCase")]
    Stage { stage: String, message: String },
    #[serde(rename_all = "camelCase")]
    ReportDelta { content: String, delta: String },
    #[serde(rename_all = "camelCase")]
    ReportUpdate { report_markdown: String },
    #[serde(rename_all = "camelCase")]
    ChatDelta { content: String, delta: String },
    #[serde(rename_all = "camelCase")]
    Billing {
        balance_usd: String,
        cost_usd: String,
    },
    #[serde(rename_all = "camelCase")]
    Done {
        report_markdown: String,
        chat_message: String,
        balance_usd: String,
        cost_usd: String,
    },
    #[serde(rename_all = "camelCase")]
    Error { code: String, message: String },
}

#[derive(Debug, Clone, PartialEq, Serialize, TS)]
#[serde(tag = "type", rename_all = "camelCase")]
#[ts(export)]
pub enum CoreEvent {
    #[serde(rename_all = "camelCase")]
    Task {
        id: String,
        label: String,
        progress: Option<f64>,
        done: bool,
        cancellable: bool,
    },
    #[serde(rename_all = "camelCase")]
    RepoChanged { path: String },
    #[serde(rename_all = "camelCase")]
    TerminalOutput { id: String, data: String },
    #[serde(rename_all = "camelCase")]
    TerminalExit { id: String },
    #[serde(rename_all = "camelCase")]
    AiReviewStream {
        repo: String,
        branch: String,
        target_branch: String,
        run_id: String,
        event: AiStreamPayload,
    },
}

pub trait EventSink: Send + Sync {
    fn emit(&self, event: CoreEvent);
}

pub struct NoEvents;

impl EventSink for NoEvents {
    fn emit(&self, _event: CoreEvent) {}
}

#[derive(Default)]
pub struct RecordedEvents {
    events: Mutex<Vec<CoreEvent>>,
}

impl RecordedEvents {
    pub fn take(&self) -> Vec<CoreEvent> {
        self.events
            .lock()
            .map(|mut e| std::mem::take(&mut *e))
            .unwrap_or_default()
    }
}

impl EventSink for RecordedEvents {
    fn emit(&self, event: CoreEvent) {
        if let Ok(mut events) = self.events.lock() {
            events.push(event);
        }
    }
}

pub struct Task<'a> {
    id: String,
    label: String,
    cancellable: bool,
    sink: &'a dyn EventSink,
}

impl<'a> Task<'a> {
    pub fn start(sink: &'a dyn EventSink, id: &str, label: String) -> Self {
        Task::begin(sink, id, label, false)
    }

    pub fn cancellable(sink: &'a dyn EventSink, id: &str, label: String) -> Self {
        Task::begin(sink, id, label, true)
    }

    fn begin(sink: &'a dyn EventSink, id: &str, label: String, cancellable: bool) -> Self {
        sink.emit(CoreEvent::Task {
            id: id.to_string(),
            label: label.clone(),
            progress: None,
            done: false,
            cancellable,
        });
        Task {
            id: id.to_string(),
            label,
            cancellable,
            sink,
        }
    }

    pub fn uncancellable(&mut self) {
        self.cancellable = false;
        self.sink.emit(CoreEvent::Task {
            id: self.id.clone(),
            label: self.label.clone(),
            progress: None,
            done: false,
            cancellable: false,
        });
    }

    pub fn progress(&mut self, label: String, progress: f64) {
        self.label = label;
        self.sink.emit(CoreEvent::Task {
            id: self.id.clone(),
            label: self.label.clone(),
            progress: Some(progress.clamp(0.0, 1.0)),
            done: false,
            cancellable: self.cancellable,
        });
    }
}

impl Drop for Task<'_> {
    fn drop(&mut self) {
        self.sink.emit(CoreEvent::Task {
            id: self.id.clone(),
            label: self.label.clone(),
            progress: Some(1.0),
            done: true,
            cancellable: self.cancellable,
        });
    }
}
