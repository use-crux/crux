use std::collections::HashSet;

use serde_json::{Map, Value, json};

use crate::{
    context::{CallParts, PrimitiveContext},
    definition::{NativeDefinitionInput, safe_id, static_index_definition},
    memory::block_metadata::memory_block_metadata_values,
    memory::blocks::{MemoryBlockMetadata, default_memory_block_schema, memory_blocks},
    memory::id::authored_memory_id,
    memory::store::{authored_store, authored_store_name, store_definition, store_id},
    protocol::{LiteralValue, StaticSyntaxValue},
    record_values::{
        direct_string_property, json_object_property, property_value, resolve_static_value,
    },
    routing::output::extracted_facts,
};

pub(crate) fn memory_facts(context: &PrimitiveContext<'_>, parts: &CallParts<'_>) -> Option<Value> {
    if parts.callee_name != "memory" || parts.callee_direct == Some(false) {
        return None;
    }
    let config = parts.object_arg?;
    let id_info = authored_memory_id(context, config);
    let definition_key = id_info
        .definition_key
        .clone()
        .unwrap_or_else(|| parts.local_name.to_string());
    let id = format!("memory:{}", safe_id(&definition_key));
    let block_projection = memory_blocks(context, parts, config, &definition_key, &id);
    let store = authored_store(context, config);
    let store_definition = store.as_ref().map(|store| {
        store_definition(
            context,
            parts,
            &definition_key,
            &id,
            "memory.uses_store",
            store,
        )
    });

    let mut metadata = Map::new();
    metadata.insert(
        "exportName".to_string(),
        Value::String(parts.variable_name.to_string()),
    );
    insert_string(
        &mut metadata,
        "runtimeIdPrefix",
        id_info.runtime_id_prefix.clone(),
    );
    metadata.extend(static_memory_metadata(
        context,
        &block_projection.blocks,
        config,
        &block_projection.definitions,
        store_definition.as_ref().and_then(store_id),
        store.as_ref(),
    ));

    let mut extra_definitions = block_projection.definitions.clone();
    extra_definitions.extend(store_definition.iter().cloned());
    let mut references = block_projection
        .definitions
        .iter()
        .filter_map(store_id)
        .map(|to_id| json!({"type": "memory.includes_block", "toId": to_id}))
        .collect::<Vec<_>>();
    if let Some(to_id) = store_definition.as_ref().and_then(store_id) {
        references.push(json!({"type": "memory.uses_store", "toId": to_id}));
    }

    Some(extracted_facts(
        parts.variable_name,
        static_index_definition(NativeDefinitionInput {
            id,
            kind: "memory",
            name: id_info
                .display_name
                .unwrap_or_else(|| parts.variable_name.to_string()),
            file: context.fingerprint_file,
            source: parts.source,
            snippet: parts.snippet,
            metadata,
        }),
        extra_definitions,
        references,
        Vec::new(),
    ))
}

fn static_memory_metadata(
    context: &PrimitiveContext<'_>,
    blocks: &[MemoryBlockMetadata],
    config: &crate::protocol::StaticSyntaxValue,
    block_definitions: &[Value],
    store_definition_id: Option<String>,
    store: Option<&crate::memory::store::StoreInfo>,
) -> Map<String, Value> {
    let schema = memory_schema(blocks);
    let backend = authored_store_name(store);
    let eviction_policy = direct_string_property(config, "evictionPolicy");
    let capture_mode = normalized_capture_mode(config, context);
    let budget =
        json_object_property(config, Some("budget"), &context.initializers).unwrap_or(None);
    let mut metadata = Map::new();
    insert_string(&mut metadata, "backend", backend.clone());
    insert_string(&mut metadata, "captureMode", capture_mode.clone());
    insert_value(&mut metadata, "budget", budget.clone());
    insert_string(&mut metadata, "evictionPolicy", eviction_policy.clone());
    if !blocks.is_empty() {
        metadata.insert(
            "blocks".to_string(),
            Value::Array(memory_block_metadata_values(blocks)),
        );
        metadata.insert("blockCount".to_string(), json!(blocks.len()));
    }
    if let Some(schema) = schema.clone() {
        metadata.insert("schema".to_string(), schema.clone());
    }
    metadata.insert(
        "facts".to_string(),
        memory_fact_metadata(backend, capture_mode, budget, eviction_policy, blocks.len()),
    );
    metadata.insert(
        "intelligence".to_string(),
        memory_intelligence(schema, block_definitions, store_definition_id),
    );
    metadata
}

fn memory_schema(blocks: &[MemoryBlockMetadata]) -> Option<Value> {
    let working_schemas = blocks
        .iter()
        .filter(|block| block.kind.as_deref() == Some("working"))
        .filter_map(|block| block.schema.clone())
        .collect::<Vec<_>>();
    if working_schemas.len() == 1 {
        return working_schemas.first().cloned();
    }
    let default_schemas = blocks
        .iter()
        .filter_map(|block| {
            block
                .schema
                .clone()
                .or_else(|| block.kind.as_deref().and_then(default_memory_block_schema))
        })
        .collect::<Vec<_>>();
    (default_schemas.len() == 1).then(|| default_schemas[0].clone())
}

fn memory_fact_metadata(
    backend: Option<String>,
    capture_mode: Option<String>,
    budget: Option<Value>,
    eviction_policy: Option<String>,
    block_count: usize,
) -> Value {
    let mut facts = Map::new();
    facts.insert("kind".to_string(), Value::String("memory".to_string()));
    insert_string(&mut facts, "backend", backend);
    insert_string(&mut facts, "captureMode", capture_mode);
    insert_value(&mut facts, "budget", budget);
    insert_string(&mut facts, "evictionPolicy", eviction_policy);
    if block_count > 0 {
        facts.insert("blockCount".to_string(), json!(block_count));
    }
    Value::Object(facts)
}

fn normalized_capture_mode(
    config: &StaticSyntaxValue,
    context: &PrimitiveContext<'_>,
) -> Option<String> {
    Some(
        match nested_string_property(config, &["capture", "mode"], context).as_deref() {
            Some("inline") => "inline",
            _ => "deferred",
        }
        .to_string(),
    )
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
            value: LiteralValue::String(value),
        } => Some(value.clone()),
        _ => None,
    }
}

fn memory_intelligence(
    schema: Option<Value>,
    block_definitions: &[Value],
    store_definition_id: Option<String>,
) -> Value {
    let mut intelligence = Map::new();
    intelligence.insert(
        "confidence".to_string(),
        Value::String("static".to_string()),
    );
    if let Some(schema) = schema {
        intelligence.insert("contract".to_string(), json!({ "schema": schema }));
    }
    let block_ids = block_definitions
        .iter()
        .filter_map(store_id)
        .collect::<Vec<_>>();
    let mut dependencies = Map::new();
    if !block_ids.is_empty() {
        dependencies.insert("blocks".to_string(), json!(block_ids));
    }
    if let Some(store_id) = store_definition_id {
        dependencies.insert("stores".to_string(), json!([store_id]));
    }
    intelligence.insert("dependencies".to_string(), Value::Object(dependencies));
    Value::Object(intelligence)
}

fn insert_string(metadata: &mut Map<String, Value>, key: &str, value: Option<String>) {
    if let Some(value) = value {
        metadata.insert(key.to_string(), Value::String(value));
    }
}

fn insert_value(metadata: &mut Map<String, Value>, key: &str, value: Option<Value>) {
    if let Some(value) = value {
        metadata.insert(key.to_string(), value);
    }
}
