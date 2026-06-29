use std::collections::HashSet;

use serde_json::{Value, json};

use crate::{
    context::{CallParts, PrimitiveContext},
    memory::block_metadata::block_definition,
    protocol::StaticSyntaxValue,
    record_values::{
        has_property, json_object_property, number_property, property_value, resolve_static_value,
    },
    schema::syntax_value_to_json_schema,
};

#[derive(Clone)]
pub(crate) struct MemoryBlockMetadata {
    pub(crate) id: Option<String>,
    pub(crate) kind: Option<String>,
    pub(crate) priority: Option<f64>,
    pub(crate) budget: Option<Value>,
    pub(crate) schema: Option<Value>,
    pub(crate) write_mode: Option<String>,
    pub(crate) has_embed: bool,
    pub(crate) render_strategy: Option<String>,
    pub(crate) render_limit: Option<f64>,
    pub(crate) retention_policy: Option<String>,
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
        budget: json_object_property(config, Some("budget"), &context.initializers).unwrap_or(None),
        schema,
        write_mode: nested_string_property(config, &["write", "mode"], context),
        has_embed: has_property(config, "embed"),
        render_strategy: render_strategy(config, context),
        render_limit: render_limit(config, context),
        retention_policy: direct_string(config, "retention"),
    })
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

fn render_strategy(object: &StaticSyntaxValue, context: &PrimitiveContext<'_>) -> Option<String> {
    let value = property_value(object, "render")?;
    let resolved = resolve_static_value(value, &context.initializers, &mut HashSet::new());
    match resolved {
        StaticSyntaxValue::Literal {
            value: crate::protocol::LiteralValue::Boolean(false),
        } => Some("disabled".to_string()),
        StaticSyntaxValue::Object { .. } => direct_string(resolved, "strategy"),
        _ => None,
    }
}

fn render_limit(object: &StaticSyntaxValue, context: &PrimitiveContext<'_>) -> Option<f64> {
    let value = property_value(object, "render")?;
    let resolved = resolve_static_value(value, &context.initializers, &mut HashSet::new());
    match resolved {
        StaticSyntaxValue::Object { .. } => {
            number_property(resolved, "limit", &context.initializers)
        }
        _ => None,
    }
}
