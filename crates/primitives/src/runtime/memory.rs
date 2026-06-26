use serde_json::{Map, Value};

use crate::runtime::join::{metadata_string, strip_definition_prefix};

pub(crate) fn memory_runtime_join(
    id: &str,
    kind: &str,
    metadata: &Map<String, Value>,
    span_attributes: &mut Map<String, Value>,
    runtime_join: &mut Map<String, Value>,
) {
    match kind {
        "memory" => memory_join(id, metadata, span_attributes, runtime_join),
        "memory.store" => memory_store_join(id, metadata, runtime_join),
        "memory.block" => memory_block_join(id, metadata, span_attributes, runtime_join),
        "blackboard" => blackboard_join(id, metadata, span_attributes, runtime_join),
        _ => {}
    }
}

fn memory_join(
    id: &str,
    metadata: &Map<String, Value>,
    span_attributes: &mut Map<String, Value>,
    runtime_join: &mut Map<String, Value>,
) {
    let memory_id = strip_definition_prefix(id, "memory:").to_string();
    span_attributes.insert("memoryId".to_string(), Value::String(memory_id.clone()));
    span_attributes.insert(
        "sourceDefinitionId".to_string(),
        Value::String(id.to_string()),
    );
    runtime_join.insert(
        "primitive".to_string(),
        Value::String("memory.*".to_string()),
    );
    runtime_join.insert("memoryId".to_string(), Value::String(memory_id));
    runtime_join.insert(
        "sourceDefinitionId".to_string(),
        Value::String(id.to_string()),
    );
    if let Some(runtime_id_prefix) = metadata_string(metadata, "runtimeIdPrefix") {
        runtime_join.insert(
            "runtimeIdPrefix".to_string(),
            Value::String(runtime_id_prefix),
        );
    }
}

fn memory_store_join(
    id: &str,
    metadata: &Map<String, Value>,
    runtime_join: &mut Map<String, Value>,
) {
    runtime_join.insert(
        "resource".to_string(),
        Value::String("memory.store".to_string()),
    );
    runtime_join.insert(
        "memoryStoreId".to_string(),
        Value::String(strip_definition_prefix(id, "memory.store:").to_string()),
    );
    if let Some(backend) = metadata_string(metadata, "backend") {
        runtime_join.insert("backend".to_string(), Value::String(backend));
    }
}

fn memory_block_join(
    id: &str,
    metadata: &Map<String, Value>,
    span_attributes: &mut Map<String, Value>,
    runtime_join: &mut Map<String, Value>,
) {
    span_attributes.insert(
        "blockDefinitionId".to_string(),
        Value::String(id.to_string()),
    );
    runtime_join.insert(
        "primitive".to_string(),
        Value::String("memory.*".to_string()),
    );
    runtime_join.insert(
        "blockDefinitionId".to_string(),
        Value::String(id.to_string()),
    );
    if let Some(memory_definition_id) = metadata_string(metadata, "memoryId") {
        let memory_id = strip_definition_prefix(&memory_definition_id, "memory:").to_string();
        span_attributes.insert(
            "sourceDefinitionId".to_string(),
            Value::String(memory_definition_id.clone()),
        );
        span_attributes.insert("memoryId".to_string(), Value::String(memory_id.clone()));
        runtime_join.insert(
            "sourceDefinitionId".to_string(),
            Value::String(memory_definition_id),
        );
        runtime_join.insert("memoryId".to_string(), Value::String(memory_id));
    }
    if let Some(block_id) = metadata_string(metadata, "blockId") {
        span_attributes.insert("blockId".to_string(), Value::String(block_id.clone()));
        runtime_join.insert("blockId".to_string(), Value::String(block_id));
    }
    if let Some(block_kind) = metadata_string(metadata, "blockKind") {
        span_attributes.insert("blockKind".to_string(), Value::String(block_kind.clone()));
        runtime_join.insert("blockKind".to_string(), Value::String(block_kind));
    }
}

fn blackboard_join(
    id: &str,
    metadata: &Map<String, Value>,
    span_attributes: &mut Map<String, Value>,
    runtime_join: &mut Map<String, Value>,
) {
    let memory_id = strip_definition_prefix(id, "blackboard:").to_string();
    span_attributes.insert("memoryId".to_string(), Value::String(memory_id.clone()));
    span_attributes.insert("blockId".to_string(), Value::String(memory_id.clone()));
    span_attributes.insert(
        "memoryType".to_string(),
        Value::String("blackboard".to_string()),
    );
    span_attributes.insert(
        "sourceDefinitionId".to_string(),
        Value::String(id.to_string()),
    );
    runtime_join.insert(
        "primitive".to_string(),
        Value::String("memory.*".to_string()),
    );
    runtime_join.insert("memoryId".to_string(), Value::String(memory_id.clone()));
    runtime_join.insert("blockId".to_string(), Value::String(memory_id));
    runtime_join.insert(
        "sourceDefinitionId".to_string(),
        Value::String(id.to_string()),
    );
    if let Some(runtime_id_prefix) = metadata_string(metadata, "runtimeIdPrefix") {
        runtime_join.insert(
            "runtimeIdPrefix".to_string(),
            Value::String(runtime_id_prefix),
        );
    }
}
