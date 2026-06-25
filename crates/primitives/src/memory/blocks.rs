use std::collections::HashSet;

use serde_json::{Map, Value, json};

use crate::{
    context::{CallParts, PrimitiveContext},
    definition::{NativeDefinitionInput, folded_index_child, safe_id, static_index_definition},
    protocol::StaticSyntaxValue,
    record_values::{has_property, number_property, property_value, resolve_static_value},
    schema::syntax_value_to_json_schema,
};

#[derive(Clone)]
pub(crate) struct MemoryBlockMetadata {
    pub(crate) id: Option<String>,
    pub(crate) kind: Option<String>,
    pub(crate) priority: Option<f64>,
    pub(crate) schema: Option<Value>,
    pub(crate) write_mode: Option<String>,
    pub(crate) has_embed: bool,
}

pub(crate) struct MemoryBlocksProjection {
    pub(crate) blocks: Vec<MemoryBlockMetadata>,
    pub(crate) definitions: Vec<Value>,
}

pub(crate) fn memory_blocks(
    context: &PrimitiveContext<'_>,
    parts: &CallParts<'_>,
    config: &StaticSyntaxValue,
    definition_key: &str,
    memory_id: &str,
) -> MemoryBlocksProjection {
    let blocks = memory_block_metadata(context, config);
    let definitions = blocks
        .iter()
        .enumerate()
        .map(|(index, block)| {
            block_definition(context, parts, definition_key, memory_id, block, index)
        })
        .collect();
    MemoryBlocksProjection {
        blocks,
        definitions,
    }
}

pub(crate) fn memory_block_metadata_values(blocks: &[MemoryBlockMetadata]) -> Vec<Value> {
    blocks.iter().map(memory_block_metadata_value).collect()
}

pub(crate) fn default_memory_block_schema(kind: &str) -> Option<Value> {
    match kind {
        "episodes" => Some(json!({
            "name": "EpisodicEntry",
            "type": "object",
            "properties": {
                "content": { "type": "string" },
                "metadata": { "type": "object", "additionalProperties": true },
                "createdAt": { "type": "number" },
                "updatedAt": { "type": "number" }
            },
            "required": ["content"],
            "additionalProperties": true
        })),
        "facts" | "procedures" | "reflections" => Some(json!({
            "name": match kind {
                "facts" => "SemanticFact",
                "procedures" => "ProcedureMemory",
                _ => "ReflectionMemory",
            },
            "type": "object",
            "properties": {
                "content": { "type": "string" },
                "metadata": { "type": "object", "additionalProperties": true },
                "confidence": { "type": "number" },
                "createdAt": { "type": "number" },
                "updatedAt": { "type": "number" }
            },
            "required": ["content"],
            "additionalProperties": true
        })),
        _ => None,
    }
}

fn memory_block_metadata(
    context: &PrimitiveContext<'_>,
    config: &StaticSyntaxValue,
) -> Vec<MemoryBlockMetadata> {
    let Some(blocks_value) = property_value(config, "blocks") else {
        return Vec::new();
    };
    let resolved = resolve_static_value(blocks_value, &context.initializers, &mut HashSet::new());
    let StaticSyntaxValue::Array { elements } = resolved else {
        return Vec::new();
    };
    elements
        .iter()
        .filter_map(|element| memory_block_metadata_from_call(context, element))
        .collect()
}

fn memory_block_metadata_from_call(
    context: &PrimitiveContext<'_>,
    value: &StaticSyntaxValue,
) -> Option<MemoryBlockMetadata> {
    let resolved = resolve_static_value(value, &context.initializers, &mut HashSet::new());
    let StaticSyntaxValue::Call { callee, args, .. } = resolved else {
        return None;
    };
    let config = object_arg(args.first()?, context)?;
    let call_name = callee.local_name.as_deref().unwrap_or(callee.name.as_str());
    let kind = memory_block_kind_for_call(call_name, config);
    let schema = property_value(config, "schema")
        .and_then(|value| syntax_value_to_json_schema(Some(value), context))
        .or_else(|| kind.as_deref().and_then(default_memory_block_schema));
    Some(MemoryBlockMetadata {
        id: direct_string(config, "id"),
        kind,
        priority: number_property(config, "priority", &context.initializers),
        schema,
        write_mode: nested_string_property(config, &["write", "mode"], context),
        has_embed: has_property(config, "embed"),
    })
}

fn block_definition(
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
    if let Some(schema) = block.schema.clone() {
        metadata.insert("schema".to_string(), schema);
    }
    insert_string(&mut metadata, "writeMode", block.write_mode.clone());
    metadata.insert("hasEmbed".to_string(), Value::Bool(block.has_embed));
    Value::Object(metadata)
}

fn memory_block_metadata_map(block: &MemoryBlockMetadata) -> Map<String, Value> {
    let mut metadata = Map::new();
    insert_string(&mut metadata, "blockId", block.id.clone());
    insert_string(&mut metadata, "blockKind", block.kind.clone());
    insert_number(&mut metadata, "priority", block.priority);
    if let Some(schema) = block.schema.clone() {
        metadata.insert("schema".to_string(), schema);
    }
    insert_string(&mut metadata, "writeMode", block.write_mode.clone());
    metadata.insert("hasEmbed".to_string(), Value::Bool(block.has_embed));
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
    insert_string(&mut facts, "writeMode", block.write_mode.clone());
    facts.insert("hasEmbed".to_string(), Value::Bool(block.has_embed));
    Value::Object(facts)
}

fn memory_block_kind_for_call(call_name: &str, config: &StaticSyntaxValue) -> Option<String> {
    match call_name {
        "workingState" => Some("working".to_string()),
        "recentMessages" => Some("recent".to_string()),
        "episodes" => Some("episodes".to_string()),
        "facts" => Some("facts".to_string()),
        "procedures" => Some("procedures".to_string()),
        "reflections" => Some("reflections".to_string()),
        "memoryBlock" => direct_string(config, "kind").or_else(|| Some("custom".to_string())),
        _ => None,
    }
}

fn object_arg<'a>(
    value: &'a StaticSyntaxValue,
    context: &PrimitiveContext<'a>,
) -> Option<&'a StaticSyntaxValue> {
    let resolved = resolve_static_value(value, &context.initializers, &mut HashSet::new());
    matches!(resolved, StaticSyntaxValue::Object { .. }).then_some(resolved)
}

fn nested_string_property(
    object: &StaticSyntaxValue,
    path: &[&str],
    context: &PrimitiveContext<'_>,
) -> Option<String> {
    let mut current = object;
    for segment in path {
        current = property_value(current, segment)?;
        current = resolve_static_value(current, &context.initializers, &mut HashSet::new());
    }
    match current {
        StaticSyntaxValue::Literal {
            value: crate::protocol::LiteralValue::String(value),
        } => Some(value.clone()),
        _ => None,
    }
}

fn direct_string(object: &StaticSyntaxValue, name: &str) -> Option<String> {
    match property_value(object, name) {
        Some(StaticSyntaxValue::Literal {
            value: crate::protocol::LiteralValue::String(value),
        }) => Some(value.clone()),
        _ => None,
    }
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
