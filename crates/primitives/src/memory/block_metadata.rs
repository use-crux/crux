use serde_json::{Map, Value, json};

use crate::{
    context::{CallParts, PrimitiveContext},
    definition::{NativeDefinitionInput, folded_index_child, safe_id, static_index_definition},
    memory::blocks::MemoryBlockMetadata,
};

pub(crate) fn memory_block_metadata_values(blocks: &[MemoryBlockMetadata]) -> Vec<Value> {
    blocks.iter().map(memory_block_metadata_value).collect()
}

pub(crate) fn block_definition(
    context: &PrimitiveContext<'_>,
    parts: &CallParts<'_>,
    definition_key: &str,
    memory_id: &str,
    block: &MemoryBlockMetadata,
    index: usize,
) -> Value {
    let block_key = block
        .id
        .as_deref()
        .or(block.kind.as_deref())
        .unwrap_or("block");
    let id = format!(
        "memory.block:{}:{}",
        safe_id(definition_key),
        safe_id(block_key)
    );
    let mut metadata = memory_block_metadata_map(block);
    metadata.insert(
        "exportName".to_string(),
        Value::String(parts.variable_name.to_string()),
    );
    metadata.insert("memoryId".to_string(), Value::String(memory_id.to_string()));
    metadata.insert(
        "indexPresentation".to_string(),
        folded_index_child(memory_id, "memory.includes_block", "block", index),
    );
    metadata.insert("facts".to_string(), memory_block_facts(memory_id, block));
    static_index_definition(NativeDefinitionInput {
        id,
        kind: "memory.block",
        name: block_key.to_string(),
        file: context.file,
        source: parts.source,
        snippet: parts.snippet,
        metadata,
    })
}

fn memory_block_metadata_value(block: &MemoryBlockMetadata) -> Value {
    let mut metadata = Map::new();
    insert_string(&mut metadata, "id", block.id.clone());
    insert_string(&mut metadata, "kind", block.kind.clone());
    insert_number(&mut metadata, "priority", block.priority);
    insert_value(&mut metadata, "budget", block.budget.clone());
    if let Some(schema) = block.schema.clone() {
        metadata.insert("schema".to_string(), schema);
    }
    insert_string(&mut metadata, "writeMode", block.write_mode.clone());
    metadata.insert("hasEmbed".to_string(), Value::Bool(block.has_embed));
    insert_string(
        &mut metadata,
        "renderStrategy",
        block.render_strategy.clone(),
    );
    insert_number(&mut metadata, "renderLimit", block.render_limit);
    insert_string(
        &mut metadata,
        "retentionPolicy",
        block.retention_policy.clone(),
    );
    Value::Object(metadata)
}

fn memory_block_metadata_map(block: &MemoryBlockMetadata) -> Map<String, Value> {
    let mut metadata = Map::new();
    insert_string(&mut metadata, "blockId", block.id.clone());
    insert_string(&mut metadata, "blockKind", block.kind.clone());
    insert_number(&mut metadata, "priority", block.priority);
    insert_value(&mut metadata, "budget", block.budget.clone());
    if let Some(schema) = block.schema.clone() {
        metadata.insert("schema".to_string(), schema);
    }
    insert_string(&mut metadata, "writeMode", block.write_mode.clone());
    metadata.insert("hasEmbed".to_string(), Value::Bool(block.has_embed));
    insert_string(
        &mut metadata,
        "renderStrategy",
        block.render_strategy.clone(),
    );
    insert_number(&mut metadata, "renderLimit", block.render_limit);
    insert_string(
        &mut metadata,
        "retentionPolicy",
        block.retention_policy.clone(),
    );
    metadata
}

fn memory_block_facts(memory_id: &str, block: &MemoryBlockMetadata) -> Value {
    let mut facts = Map::new();
    facts.insert(
        "kind".to_string(),
        Value::String("memory.block".to_string()),
    );
    facts.insert("memoryId".to_string(), Value::String(memory_id.to_string()));
    insert_string(&mut facts, "blockId", block.id.clone());
    insert_string(&mut facts, "blockKind", block.kind.clone());
    insert_number(&mut facts, "priority", block.priority);
    insert_value(&mut facts, "budget", block.budget.clone());
    insert_string(&mut facts, "writeMode", block.write_mode.clone());
    facts.insert("hasEmbed".to_string(), Value::Bool(block.has_embed));
    insert_string(&mut facts, "renderStrategy", block.render_strategy.clone());
    insert_number(&mut facts, "renderLimit", block.render_limit);
    insert_string(
        &mut facts,
        "retentionPolicy",
        block.retention_policy.clone(),
    );
    Value::Object(facts)
}

fn insert_string(metadata: &mut Map<String, Value>, key: &str, value: Option<String>) {
    if let Some(value) = value {
        metadata.insert(key.to_string(), Value::String(value));
    }
}

fn insert_number(metadata: &mut Map<String, Value>, key: &str, value: Option<f64>) {
    if let Some(value) = value {
        metadata.insert(key.to_string(), json!(value));
    }
}

fn insert_value(metadata: &mut Map<String, Value>, key: &str, value: Option<Value>) {
    if let Some(value) = value {
        metadata.insert(key.to_string(), value);
    }
}
