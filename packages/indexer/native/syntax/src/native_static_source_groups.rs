//! Grouped source facts emitted by native static analyze.

use std::collections::BTreeSet;

use serde_json::{Map, Value, json};

pub(crate) fn grouped_source_facts(
    root: &str,
    project_name: Option<&str>,
    file: &str,
    dependencies: Vec<String>,
    has_native_facts: bool,
) -> Option<Value> {
    if dependencies.is_empty() && !has_native_facts {
        return None;
    }
    let dependencies = dependencies
        .into_iter()
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect::<Vec<_>>();
    let mut grouped = Map::new();
    grouped.insert("root".to_string(), Value::String(root.to_string()));
    if let Some(project_name) = project_name {
        grouped.insert(
            "projectName".to_string(),
            Value::String(project_name.to_string()),
        );
    }
    grouped.insert(
        "sources".to_string(),
        json!([{
            "file": file,
            "status": "indexed",
            "dependencies": dependencies
        }]),
    );
    Some(Value::Object(grouped))
}
