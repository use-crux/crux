use serde_json::{Map, Value, json};

use crate::{
    context::{CallParts, PrimitiveContext},
    definition::{NativeDefinitionInput, safe_id, static_index_definition},
    record_values::{
        direct_string_property, has_property, object_array_value, object_map_identifier_entries,
        object_value, property_value,
    },
    routing::output::extracted_facts,
};

pub(crate) fn workspace_facts(
    context: &PrimitiveContext<'_>,
    parts: &CallParts<'_>,
) -> Option<Value> {
    if parts.callee_name != "workspace" {
        return None;
    }
    let config = parts.object_arg.and_then(object_value);
    let explicit_id = config.and_then(|config| direct_string_property(config, "id"));
    let local_id = explicit_id
        .clone()
        .unwrap_or_else(|| parts.local_name.to_string());
    let id = format!("workspace:{}", safe_id(&local_id));
    let tool_refs = config
        .map(|config| {
            object_map_identifier_entries(property_value(config, "tools"), &context.initializers)
        })
        .unwrap_or_default()
        .into_iter()
        .map(|(_, value)| value)
        .collect::<Vec<_>>();
    let mounts = config
        .map(|config| workspace_mounts(config, context))
        .unwrap_or_default();

    let mut metadata = Map::new();
    metadata.insert(
        "exportName".to_string(),
        Value::String(parts.variable_name.to_string()),
    );
    if let Some(namespace) = config.and_then(|config| direct_string_property(config, "namespace")) {
        metadata.insert("namespace".to_string(), Value::String(namespace));
    }
    if !mounts.is_empty() {
        metadata.insert("mounts".to_string(), Value::Array(mounts.clone()));
    }
    if let Some(config) = config {
        metadata.insert(
            "hasTools".to_string(),
            Value::Bool(has_property(config, "tools")),
        );
    }
    if !tool_refs.is_empty() {
        metadata.insert("toolRefs".to_string(), json!(tool_refs));
    }
    if let Some(config) = config {
        metadata.insert(
            "hasBlobStorage".to_string(),
            Value::Bool(has_property(config, "blobs") || has_property(config, "storage")),
        );
    }
    if let Some(intelligence) = workspace_intelligence(&mounts, &tool_refs) {
        metadata.insert("intelligence".to_string(), intelligence);
    }

    Some(extracted_facts(
        parts.variable_name,
        static_index_definition(NativeDefinitionInput {
            id: id.clone(),
            kind: "workspace",
            name: explicit_id.unwrap_or_else(|| parts.variable_name.to_string()),
            file: context.file,
            source: parts.source,
            snippet: parts.snippet,
            metadata,
        }),
        Vec::new(),
        tool_refs
            .iter()
            .map(|to_variable| json!({"type": "workspace.exposes_tool", "toVariable": to_variable}))
            .chain(mounts.iter().filter_map(|mount| {
                mount.get("path").and_then(Value::as_str).map(|path| {
                    json!({
                        "type": "workspace.mounts_path",
                        "toId": format!("workspace.path:{}:{}", safe_id(&local_id), safe_id(path)),
                    })
                })
            }))
            .collect(),
        Vec::new(),
    ))
}

fn workspace_mounts(
    config: &crate::protocol::StaticSyntaxValue,
    context: &PrimitiveContext<'_>,
) -> Vec<Value> {
    object_array_value(property_value(config, "mounts"), &context.initializers)
        .into_iter()
        .filter_map(|mount| {
            let mut value = Map::new();
            insert_string(&mut value, "path", direct_string_property(mount, "path"));
            insert_string(
                &mut value,
                "access",
                direct_string_property(mount, "access"),
            );
            insert_string(
                &mut value,
                "description",
                direct_string_property(mount, "description"),
            );
            (!value.is_empty()).then_some(Value::Object(value))
        })
        .collect()
}

fn workspace_intelligence(mounts: &[Value], tool_refs: &[String]) -> Option<Value> {
    if mounts.is_empty() && tool_refs.is_empty() {
        return None;
    }
    let artifacts = mounts
        .iter()
        .filter_map(|mount| {
            let path = mount.get("path").and_then(Value::as_str)?;
            Some(json!({"name": path, "kind": mount.get("access").and_then(Value::as_str).unwrap_or("mount")}))
        })
        .collect::<Vec<_>>();
    let mut intelligence = Map::new();
    intelligence.insert(
        "confidence".to_string(),
        Value::String("static".to_string()),
    );
    let mut data = Map::new();
    if !artifacts.is_empty() {
        data.insert("artifacts".to_string(), Value::Array(artifacts));
    }
    intelligence.insert("data".to_string(), Value::Object(data));
    if !tool_refs.is_empty() {
        intelligence.insert("tools".to_string(), json!(tool_refs));
    }
    Some(Value::Object(intelligence))
}

fn insert_string(metadata: &mut Map<String, Value>, key: &str, value: Option<String>) {
    if let Some(value) = value {
        metadata.insert(key.to_string(), Value::String(value));
    }
}
