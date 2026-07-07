//! Grouped source facts emitted by Static Index analyze.

use std::collections::BTreeSet;

use serde_json::{Map, Value, json};

pub(crate) struct SourceHashEvidence<'a> {
    pub(crate) file: &'a str,
    pub(crate) source_hash: &'a str,
    pub(crate) interface_hash: Option<&'a str>,
}

pub(crate) fn grouped_source_facts(
    root: &str,
    project_name: Option<&str>,
    file: &str,
    source_hash: &str,
    interface_hash: Option<&str>,
    dependencies: Vec<String>,
    dependency_evidence: Vec<SourceHashEvidence<'_>>,
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
    let mut source_rows = Vec::new();
    let mut source_row = json!({
            "file": file,
            "status": "indexed",
            "sourceHash": source_hash,
            "dependencies": dependencies
    });
    if let Some(interface_hash) = interface_hash {
        source_row["interfaceHash"] = Value::String(interface_hash.to_string());
    }
    source_rows.push(source_row);
    for evidence in dependency_evidence {
        if evidence.file == file {
            continue;
        }
        let mut row = json!({
            "file": evidence.file,
            "status": "indexed",
            "sourceHash": evidence.source_hash
        });
        if let Some(interface_hash) = evidence.interface_hash {
            row["interfaceHash"] = Value::String(interface_hash.to_string());
        }
        source_rows.push(row);
    }
    grouped.insert("sources".to_string(), Value::Array(source_rows));
    Some(Value::Object(grouped))
}
