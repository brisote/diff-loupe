use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use ts_rs::TS;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum Viewer {
    #[default]
    SideBySide,
    Unified,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Default, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum Whitespace {
    #[default]
    DoNotIgnore,
    Trim,
    Ignore,
    IgnoreAndEmptyLines,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Default, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum Highlight {
    #[default]
    Words,
    Lines,
    Characters,
    None,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum MarkdownView {
    #[default]
    RenderedSideBySide,
    RenderedInline,
    Raw,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", default)]
#[ts(export)]
pub struct DiffSettings {
    pub viewer: Viewer,
    pub whitespace: Whitespace,
    pub highlight: Highlight,
    pub collapse_unchanged: bool,
    pub sync_scroll: bool,
    pub markdown: MarkdownView,
}

impl Default for DiffSettings {
    fn default() -> Self {
        DiffSettings {
            viewer: Viewer::SideBySide,
            whitespace: Whitespace::DoNotIgnore,
            highlight: Highlight::Words,
            collapse_unchanged: true,
            sync_scroll: true,
            markdown: MarkdownView::RenderedSideBySide,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", default)]
#[ts(export)]
pub struct UpdateSettings {
    pub check: bool,
}

impl Default for UpdateSettings {
    fn default() -> Self {
        UpdateSettings { check: true }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", default)]
#[ts(export)]
pub struct Settings {
    pub diff: DiffSettings,
    pub updates: UpdateSettings,
}

impl Settings {
    pub fn from_raw(raw: &Value) -> (Settings, Vec<String>) {
        let mut merged = serde_json::to_value(Settings::default()).unwrap_or(Value::Null);
        let mut rejected = Vec::new();
        for path in leaf_paths(&merged, &mut Vec::new()) {
            let Some(value) = lookup(raw, &path) else {
                continue;
            };
            let mut candidate = merged.clone();
            if let Some(slot) = lookup_mut(&mut candidate, &path) {
                *slot = value.clone();
            }
            if serde_json::from_value::<Settings>(candidate.clone()).is_ok() {
                merged = candidate;
            } else {
                rejected.push(path.join("."));
            }
        }
        (serde_json::from_value(merged).unwrap_or_default(), rejected)
    }
}

fn leaf_paths(value: &Value, prefix: &mut Vec<String>) -> Vec<Vec<String>> {
    match value {
        Value::Object(map) => map
            .iter()
            .flat_map(|(key, child)| {
                prefix.push(key.clone());
                let found = leaf_paths(child, prefix);
                prefix.pop();
                found
            })
            .collect(),
        _ => vec![prefix.clone()],
    }
}

fn lookup<'a>(value: &'a Value, path: &[String]) -> Option<&'a Value> {
    path.iter().try_fold(value, |node, key| node.get(key))
}

fn lookup_mut<'a>(value: &'a mut Value, path: &[String]) -> Option<&'a mut Value> {
    path.iter().try_fold(value, |node, key| node.get_mut(key))
}

pub fn merge_into(raw: &mut Value, known: Value) {
    match (raw, known) {
        (Value::Object(target), Value::Object(source)) => merge_maps(target, source),
        (slot, value) => *slot = value,
    }
}

fn merge_maps(target: &mut Map<String, Value>, source: Map<String, Value>) {
    for (key, value) in source {
        match target.get_mut(&key) {
            Some(existing) if existing.is_object() && value.is_object() => {
                merge_into(existing, value)
            }
            _ => {
                target.insert(key, value);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn defaults_follow_the_design() {
        let s = Settings::default();
        assert_eq!(s.diff.viewer, Viewer::SideBySide);
        assert!(s.diff.collapse_unchanged);
        assert_eq!(s.diff.markdown, MarkdownView::RenderedSideBySide);
    }

    #[test]
    fn partial_json_fills_defaults() {
        let s: Settings = serde_json::from_value(json!({"diff": {"viewer": "unified"}})).unwrap();
        assert_eq!(s.diff.viewer, Viewer::Unified);
        assert!(s.diff.sync_scroll);
    }

    #[test]
    fn merge_keeps_unknown_keys_at_every_level() {
        let mut raw = json!({"future": 1, "diff": {"viewer": "unified", "experimental": true}});
        merge_into(&mut raw, serde_json::to_value(Settings::default()).unwrap());
        assert_eq!(raw["future"], json!(1));
        assert_eq!(raw["diff"]["experimental"], json!(true));
        assert_eq!(raw["diff"]["viewer"], json!("sideBySide"));
    }
}
