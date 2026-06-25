//! Record-backed prompt/context tree path projection for Static Index analyze.
//!
//! The TypeScript compiler adds path overlays from `createPrompts` and `createContexts` trees
//! after primitive extraction. Native analyze emits the same minimal duplicate definitions and lets
//! finalization merge them into the richer primary prompt/context rows.

use std::collections::HashMap;

use serde_json::{Map, Value, json};

use crate::protocol::{
    StaticInitializerRecord, StaticNativeFactProjection, StaticSourceMatch, StaticSyntaxFileRecord,
    StaticSyntaxValue,
};

pub(crate) fn grouped_tree_path_definition_facts(
    root: &str,
    project_name: Option<&str>,
    record: &StaticSyntaxFileRecord,
    native_facts: &[StaticNativeFactProjection],
    records_by_file: &HashMap<String, StaticSyntaxFileRecord>,
) -> Option<Value> {
    let local = definitions_by_variable(native_facts);
    let mut definitions = Vec::new();
    for initializer in &record.local_initializers {
        let Some((kind, object)) = tree_container(initializer) else {
            continue;
        };
        append_path_definitions(
            &mut definitions,
            TreeWalk {
                kind,
                object,
                path: Vec::new(),
                local: &local,
                record,
                records_by_file,
            },
        );
    }

    if definitions.is_empty() {
        return None;
    }

    let mut group = Map::new();
    group.insert("root".to_string(), Value::String(root.to_string()));
    if let Some(project_name) = project_name {
        group.insert(
            "projectName".to_string(),
            Value::String(project_name.to_string()),
        );
    }
    group.insert("definitions".to_string(), Value::Array(definitions));
    Some(Value::Object(group))
}

struct TreeWalk<'a> {
    kind: &'static str,
    object: &'a StaticSyntaxValue,
    path: Vec<String>,
    local: &'a HashMap<String, Value>,
    record: &'a StaticSyntaxFileRecord,
    records_by_file: &'a HashMap<String, StaticSyntaxFileRecord>,
}

fn append_path_definitions(definitions: &mut Vec<Value>, input: TreeWalk<'_>) {
    let StaticSyntaxValue::Object { properties, .. } = input.object else {
        return;
    };
    for property in properties
        .iter()
        .filter(|property| property.spread != Some(true))
    {
        let mut next_path = input.path.clone();
        next_path.push(property.name.clone());
        if matches!(property.value, StaticSyntaxValue::Object { .. }) {
            append_path_definitions(
                definitions,
                TreeWalk {
                    object: &property.value,
                    path: next_path,
                    ..input
                },
            );
            continue;
        }

        let StaticSyntaxValue::Identifier { name } = &property.value else {
            continue;
        };
        if let Some(definition) = resolve_tree_leaf_definition(
            name,
            input.kind,
            input.local,
            input.record,
            input.records_by_file,
        ) {
            definitions.push(path_overlay_definition(&definition, next_path));
        }
    }
}

fn tree_container(
    initializer: &StaticInitializerRecord,
) -> Option<(&'static str, &StaticSyntaxValue)> {
    let StaticSyntaxValue::Call { callee, args, .. } = &initializer.value else {
        return None;
    };
    let first_arg = args.first()?;
    let kind = match callee.name.as_str() {
        "createPrompts" => "prompt",
        "createContexts" => "context",
        _ => return None,
    };
    matches!(first_arg, StaticSyntaxValue::Object { .. }).then_some((kind, first_arg))
}

fn resolve_tree_leaf_definition(
    identifier: &str,
    kind: &str,
    local: &HashMap<String, Value>,
    record: &StaticSyntaxFileRecord,
    records_by_file: &HashMap<String, StaticSyntaxFileRecord>,
) -> Option<Value> {
    if let Some(definition) = local
        .get(identifier)
        .filter(|definition| definition_kind(definition) == Some(kind))
    {
        return Some(definition.clone());
    }

    let import = record
        .imports
        .iter()
        .find(|import| import.local_name == identifier)?;
    if import.imported_name == "default" {
        return None;
    }
    let imported_record = records_by_file.get(import.resolved_file.as_ref()?)?;
    exported_definitions_by_variable(imported_record)
        .get(&import.imported_name)
        .filter(|definition| definition_kind(definition) == Some(kind))
        .cloned()
}

fn definitions_by_variable(native_facts: &[StaticNativeFactProjection]) -> HashMap<String, Value> {
    native_facts
        .iter()
        .flat_map(|projection| fact_definitions_by_variable(&projection.facts))
        .collect()
}

fn exported_definitions_by_variable(record: &StaticSyntaxFileRecord) -> HashMap<String, Value> {
    record
        .native_facts
        .iter()
        .filter(|projection| source_match_exported(record.matches.get(projection.match_index)))
        .flat_map(|projection| fact_definitions_by_variable(&projection.facts))
        .collect()
}

fn fact_definitions_by_variable(facts: &Value) -> Vec<(String, Value)> {
    facts
        .get("definitions")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|entry| {
            let variable_name = entry.get("variableName")?.as_str()?.to_string();
            let definition = entry.get("definition")?.clone();
            Some((variable_name, definition))
        })
        .collect()
}

fn path_overlay_definition(definition: &Value, path: Vec<String>) -> Value {
    json!({
        "id": definition["id"].clone(),
        "kind": definition["kind"].clone(),
        "name": definition["name"].clone(),
        "path": path,
        "fidelity": definition["fidelity"].clone(),
        "status": definition.get("status").cloned().unwrap_or(Value::Null),
    })
}

fn source_match_exported(source_match: Option<&StaticSourceMatch>) -> bool {
    match source_match {
        Some(StaticSourceMatch::Call { exported, .. })
        | Some(StaticSourceMatch::New { exported, .. })
        | Some(StaticSourceMatch::Object { exported, .. }) => *exported,
        None => false,
    }
}

fn definition_kind(definition: &Value) -> Option<&str> {
    definition.get("kind").and_then(Value::as_str)
}
