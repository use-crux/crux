use std::collections::HashSet;

use serde_json::{Map, Value, json};

use crate::{
    context::{CallParts, PrimitiveContext},
    definition::{NativeDefinitionInput, safe_id, static_index_definition},
    protocol::{LiteralValue, StaticSyntaxValue},
    record_values::{
        direct_string_property, has_property, number_property, object_array_value,
        object_map_identifier_entries, object_value, property_value, reference_property,
        resolve_static_value,
    },
    routing::output::extracted_facts,
    storage::dependencies::{
        storage_config_references, storage_dependency_metadata, storage_relation_refs,
    },
};

const RETRIEVER_WORKSPACE_MOUNT_SOURCE_HELPER: &str = "retrieverWorkspaceMountSource";
const RETRIEVER_WORKSPACE_MOUNT_SOURCE_CAPABILITIES: [&str; 5] =
    ["list", "read", "grep", "exists", "stat"];
const WORKSPACE_MOUNT_SOURCE_CAPABILITY_PROPERTIES: [&str; 7] =
    ["list", "read", "grep", "exists", "stat", "write", "delete"];

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
    let tools = config.and_then(|config| workspace_tools(config, context));
    let limits = config.and_then(|config| workspace_limits(config, context));
    let retention = config.and_then(|config| workspace_retention(config, context));
    let versioning = config.and_then(|config| workspace_versioning(config, context));
    let storage_refs = storage_config_references(config, &context.initializers);
    let storage_dependencies = storage_dependency_metadata(&storage_refs);

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
    if let Some(tools) = tools.clone() {
        metadata.insert("tools".to_string(), tools);
    }
    if !tool_refs.is_empty() {
        metadata.insert("toolRefs".to_string(), json!(tool_refs));
    }
    if let Some(limits) = limits.clone() {
        metadata.insert("limits".to_string(), limits);
    }
    if let Some(retention) = retention.clone() {
        metadata.insert("retention".to_string(), retention);
    }
    if let Some(versioning) = versioning.clone() {
        metadata.insert("versioning".to_string(), versioning);
    }
    if let Some(config) = config {
        metadata.insert(
            "hasBlobStorage".to_string(),
            Value::Bool(has_property(config, "blobs") || has_property(config, "storage")),
        );
    }
    if let Some(intelligence) = workspace_intelligence(
        &mounts,
        &tool_refs,
        limits,
        retention,
        versioning,
        storage_dependencies,
    ) {
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
            .chain(storage_relation_refs("workspace", &storage_refs))
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
            if let Some(source) = workspace_mount_source(mount, context) {
                value.insert("source".to_string(), source);
            }
            (!value.is_empty()).then_some(Value::Object(value))
        })
        .collect()
}

fn workspace_mount_source(
    mount: &StaticSyntaxValue,
    context: &PrimitiveContext<'_>,
) -> Option<Value> {
    let source_value = property_value(mount, "source")?;
    let resolved = resolve_static_value(source_value, &context.initializers, &mut HashSet::new());
    if let Some(source) = object_value(resolved) {
        return workspace_mount_object_source(source, context);
    }
    match resolved {
        StaticSyntaxValue::Call { callee, .. } => {
            let helper = callee.local_name.as_deref().unwrap_or(&callee.name);
            if helper == RETRIEVER_WORKSPACE_MOUNT_SOURCE_HELPER {
                Some(json!({
                    "kind": "retriever",
                    "helper": RETRIEVER_WORKSPACE_MOUNT_SOURCE_HELPER,
                    "capabilities": RETRIEVER_WORKSPACE_MOUNT_SOURCE_CAPABILITIES,
                }))
            } else {
                let mut metadata = Map::new();
                metadata.insert("kind".to_string(), Value::String("custom".to_string()));
                metadata.insert("helper".to_string(), Value::String(helper.to_string()));
                Some(Value::Object(metadata))
            }
        }
        StaticSyntaxValue::Identifier { name } | StaticSyntaxValue::PropertyAccess { name, .. } => {
            let mut metadata = Map::new();
            metadata.insert("kind".to_string(), Value::String("custom".to_string()));
            metadata.insert("reference".to_string(), Value::String(name.clone()));
            Some(Value::Object(metadata))
        }
        _ => Some(json!({ "kind": "unknown" })),
    }
}

fn workspace_mount_object_source(
    source: &StaticSyntaxValue,
    context: &PrimitiveContext<'_>,
) -> Option<Value> {
    let kind = direct_string_property(source, "kind").unwrap_or_else(|| "custom".to_string());
    let mut metadata = Map::new();
    metadata.insert("kind".to_string(), Value::String(kind.clone()));
    insert_string(
        &mut metadata,
        "retriever",
        reference_property(source, "retriever", &context.initializers),
    );
    if let Some(capabilities) = workspace_mount_source_capabilities(source, &kind) {
        metadata.insert("capabilities".to_string(), capabilities);
    }
    Some(Value::Object(metadata))
}

fn workspace_mount_source_capabilities(source: &StaticSyntaxValue, kind: &str) -> Option<Value> {
    if kind == "retriever" {
        return Some(json!(RETRIEVER_WORKSPACE_MOUNT_SOURCE_CAPABILITIES));
    }
    let capabilities = WORKSPACE_MOUNT_SOURCE_CAPABILITY_PROPERTIES
        .iter()
        .copied()
        .filter(|property| has_property(source, property))
        .collect::<Vec<_>>();
    (!capabilities.is_empty()).then_some(json!(capabilities))
}

fn workspace_limits(config: &StaticSyntaxValue, context: &PrimitiveContext<'_>) -> Option<Value> {
    let limits = object_value(property_value(config, "limits")?)?;
    compact_number_metadata([
        (
            "maxFileBytes",
            number_property(limits, "maxFileBytes", &context.initializers),
        ),
        (
            "maxNamespaceBytes",
            number_property(limits, "maxNamespaceBytes", &context.initializers),
        ),
    ])
}

fn workspace_retention(
    config: &StaticSyntaxValue,
    context: &PrimitiveContext<'_>,
) -> Option<Value> {
    let retention = object_value(property_value(config, "retention")?)?;
    compact_number_metadata([(
        "ttlMs",
        number_property(retention, "ttlMs", &context.initializers),
    )])
}

fn workspace_versioning(
    config: &StaticSyntaxValue,
    context: &PrimitiveContext<'_>,
) -> Option<Value> {
    let versioning = object_value(property_value(config, "versioning")?)?;
    compact_number_metadata([(
        "maxVersions",
        number_property(versioning, "maxVersions", &context.initializers),
    )])
}

fn compact_number_metadata<const N: usize>(entries: [(&str, Option<f64>); N]) -> Option<Value> {
    let mut metadata = Map::new();
    for (key, value) in entries {
        if let Some(value) = value {
            metadata.insert(key.to_string(), json!(value));
        }
    }
    (!metadata.is_empty()).then_some(Value::Object(metadata))
}

fn workspace_tools(config: &StaticSyntaxValue, context: &PrimitiveContext<'_>) -> Option<Value> {
    let tools = object_value(property_value(config, "tools")?)?;
    let prefix = string_property(tools, "prefix", context);
    let delete = boolean_property(tools, "delete", context).unwrap_or(false);
    let undo = boolean_property(tools, "undo", context).unwrap_or(false);
    let mut metadata = Map::new();
    if let Some(prefix) = prefix.clone() {
        metadata.insert("prefix".to_string(), Value::String(prefix));
    }
    if delete {
        metadata.insert("delete".to_string(), Value::Bool(true));
    }
    if undo {
        metadata.insert("undo".to_string(), Value::Bool(true));
    }
    metadata.insert(
        "generated".to_string(),
        workspace_generated_tool_names(prefix.as_deref(), delete, undo),
    );
    Some(Value::Object(metadata))
}

fn workspace_generated_tool_names(prefix: Option<&str>, delete: bool, undo: bool) -> Value {
    let part = prefix.map(capitalize_ascii).unwrap_or_default();
    let mut generated = Map::new();
    generated.insert(
        "list".to_string(),
        Value::String(format!("list{part}Workspace")),
    );
    generated.insert(
        "readFile".to_string(),
        Value::String(format!("read{part}WorkspaceFile")),
    );
    generated.insert(
        "writeFile".to_string(),
        Value::String(format!("write{part}WorkspaceFile")),
    );
    generated.insert(
        "editFile".to_string(),
        Value::String(format!("edit{part}WorkspaceFile")),
    );
    generated.insert(
        "renameFile".to_string(),
        Value::String(format!("rename{part}WorkspaceFile")),
    );
    generated.insert(
        "grep".to_string(),
        Value::String(format!("grep{part}Workspace")),
    );
    if delete {
        generated.insert(
            "deleteFile".to_string(),
            Value::String(format!("delete{part}WorkspaceFile")),
        );
    }
    if undo {
        generated.insert(
            "undoFile".to_string(),
            Value::String(format!("undo{part}WorkspaceFile")),
        );
    }
    Value::Object(generated)
}

fn capitalize_ascii(value: &str) -> String {
    let mut chars = value.chars();
    let Some(first) = chars.next() else {
        return String::new();
    };
    format!("{}{}", first.to_ascii_uppercase(), chars.as_str())
}

fn string_property(
    object: &StaticSyntaxValue,
    name: &str,
    context: &PrimitiveContext<'_>,
) -> Option<String> {
    match property_value(object, name)
        .map(|value| resolve_static_value(value, &context.initializers, &mut HashSet::new()))
    {
        Some(StaticSyntaxValue::Literal {
            value: LiteralValue::String(value),
        }) => Some(value.clone()),
        _ => None,
    }
}

fn boolean_property(
    object: &StaticSyntaxValue,
    name: &str,
    context: &PrimitiveContext<'_>,
) -> Option<bool> {
    match property_value(object, name)
        .map(|value| resolve_static_value(value, &context.initializers, &mut HashSet::new()))
    {
        Some(StaticSyntaxValue::Literal {
            value: LiteralValue::Boolean(value),
        }) => Some(*value),
        _ => None,
    }
}

fn workspace_intelligence(
    mounts: &[Value],
    tool_refs: &[String],
    limits: Option<Value>,
    retention: Option<Value>,
    versioning: Option<Value>,
    dependencies: Option<Value>,
) -> Option<Value> {
    let has_operator = limits.is_some() || retention.is_some() || versioning.is_some();
    let has_dependencies = dependencies.is_some();
    if mounts.is_empty() && tool_refs.is_empty() && !has_operator && !has_dependencies {
        return None;
    }
    let mount_rows = mounts
        .iter()
        .filter_map(workspace_intelligence_mount)
        .collect::<Vec<_>>();
    let artifacts = mount_rows
        .iter()
        .filter_map(workspace_intelligence_artifact)
        .collect::<Vec<_>>();
    let mut intelligence = Map::new();
    intelligence.insert(
        "confidence".to_string(),
        Value::String("static".to_string()),
    );
    let mut data = Map::new();
    if !mounts.is_empty() {
        data.insert("mounts".to_string(), Value::Array(mount_rows));
        data.insert("artifacts".to_string(), Value::Array(artifacts));
    }
    intelligence.insert("data".to_string(), Value::Object(data));
    if !tool_refs.is_empty() {
        intelligence.insert("tools".to_string(), json!(tool_refs));
    }
    if let Some(dependencies) = dependencies {
        intelligence.insert("dependencies".to_string(), dependencies);
    }
    if has_operator {
        let mut operator = Map::new();
        if let Some(limits) = limits {
            operator.insert("limits".to_string(), limits);
        }
        if let Some(retention) = retention {
            operator.insert("retention".to_string(), retention);
        }
        if let Some(versioning) = versioning {
            operator.insert("versioning".to_string(), versioning);
        }
        intelligence.insert("operator".to_string(), Value::Object(operator));
    }
    Some(Value::Object(intelligence))
}

fn workspace_intelligence_mount(mount: &Value) -> Option<Value> {
    let path = mount.get("path").and_then(Value::as_str)?;
    let mut metadata = Map::new();
    metadata.insert("path".to_string(), Value::String(path.to_string()));
    insert_string_from_value(&mut metadata, "access", mount.get("access"));
    insert_string_from_value(&mut metadata, "description", mount.get("description"));
    if let Some(source) = mount.get("source") {
        insert_string_from_value(&mut metadata, "sourceKind", source.get("kind"));
        insert_string_from_value(&mut metadata, "sourceHelper", source.get("helper"));
        insert_string_from_value(&mut metadata, "sourceReference", source.get("reference"));
        insert_string_from_value(&mut metadata, "sourceRetriever", source.get("retriever"));
        if let Some(capabilities) = source.get("capabilities") {
            metadata.insert("sourceCapabilities".to_string(), capabilities.clone());
        }
    }
    Some(Value::Object(metadata))
}

fn workspace_intelligence_artifact(mount: &Value) -> Option<Value> {
    let path = mount.get("path").and_then(Value::as_str)?;
    let mut metadata = Map::new();
    metadata.insert("name".to_string(), Value::String(path.to_string()));
    metadata.insert(
        "kind".to_string(),
        Value::String(
            mount
                .get("access")
                .and_then(Value::as_str)
                .unwrap_or("mount")
                .to_string(),
        ),
    );
    insert_string_from_value(&mut metadata, "sourceKind", mount.get("sourceKind"));
    insert_string_from_value(&mut metadata, "sourceHelper", mount.get("sourceHelper"));
    Some(Value::Object(metadata))
}

fn insert_string(metadata: &mut Map<String, Value>, key: &str, value: Option<String>) {
    if let Some(value) = value {
        metadata.insert(key.to_string(), Value::String(value));
    }
}

fn insert_string_from_value(metadata: &mut Map<String, Value>, key: &str, value: Option<&Value>) {
    if let Some(value) = value.and_then(Value::as_str) {
        metadata.insert(key.to_string(), Value::String(value.to_string()));
    }
}
