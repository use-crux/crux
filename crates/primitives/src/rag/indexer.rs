use serde_json::{Map, Value, json};

use crate::{
    context::{CallParts, PrimitiveContext},
    definition::{NativeDefinitionInput, safe_id},
    embedding::safe_definition::byte_safe_embedding_definition,
    record_values::{direct_string_property, reference_property},
    routing::output::extracted_facts,
};

const INDEXER_MODULES: &[&str] = &["@use-crux/core/indexing", "@use-crux/core"];

/// Projects one authored vector indexer and its embedding dependencies.
pub(crate) fn rag_indexer_facts(
    context: &PrimitiveContext<'_>,
    parts: &CallParts<'_>,
) -> Option<Value> {
    if !parts
        .callee_module_specifier
        .is_some_and(|module| INDEXER_MODULES.contains(&module))
    {
        return None;
    }
    let config = parts.object_arg?;
    let indexer_id = direct_string_property(config, "id");
    let namespace = direct_string_property(config, "namespace");
    let id = format!(
        "rag.indexer:{}",
        safe_id(indexer_id.as_deref().unwrap_or(parts.local_name))
    );
    let mut facts = Map::new();
    facts.insert("kind".to_string(), Value::String("rag.indexer".to_string()));
    if let Some(indexer_id) = &indexer_id {
        facts.insert("indexerId".to_string(), Value::String(indexer_id.clone()));
    }
    if let Some(namespace) = &namespace {
        facts.insert("namespace".to_string(), Value::String(namespace.clone()));
    }
    let mut metadata = Map::new();
    if parts.exported {
        metadata.insert(
            "exportName".to_string(),
            Value::String(parts.variable_name.to_string()),
        );
    }
    metadata.insert("facts".to_string(), Value::Object(facts));

    let references = [
        ("dense", "rag.indexer.uses_dense_embedding"),
        ("sparse", "rag.indexer.uses_sparse_embedding"),
    ]
    .into_iter()
    .filter_map(|(property, relation)| {
        reference_property(config, property, &context.initializers)
            .map(|target| json!({ "type": relation, "toVariable": target }))
    })
    .collect();

    Some(extracted_facts(
        parts.variable_name,
        byte_safe_embedding_definition(NativeDefinitionInput {
            id,
            kind: "rag.indexer",
            name: indexer_id.unwrap_or_else(|| parts.variable_name.to_string()),
            file: context.fingerprint_file,
            source: parts.source,
            snippet: parts.snippet,
            metadata,
        }),
        Vec::new(),
        references,
        Vec::new(),
    ))
}
