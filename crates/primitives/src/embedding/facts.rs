use std::collections::HashSet;

use serde_json::{Map, Value};

use crate::{
    context::{CallParts, PrimitiveContext},
    definition::{NativeDefinitionInput, safe_id},
    embedding::core::core_embedding_facts,
    embedding::provider::provider_embedding_facts,
    embedding::safe_definition::byte_safe_embedding_definition,
    record_values::resolve_static_value,
    routing::output::extracted_facts,
};

const CORE_EMBEDDING_MODULES: &[&str] = &["@use-crux/core", "@use-crux/core/embedding"];

/// Projects a first-party embedding definition from byte-safe literal config.
pub(crate) fn embedding_facts(
    context: &PrimitiveContext<'_>,
    parts: &CallParts<'_>,
) -> Option<Value> {
    let config_index = match parts.callee_module_specifier {
        Some(module) if CORE_EMBEDDING_MODULES.contains(&module) => 0,
        Some("@use-crux/google" | "@use-crux/openai") => 1,
        Some("@use-crux/ai") => 0,
        _ => return None,
    };
    let config = parts.object_arg.or_else(|| {
        parts
            .args
            .get(config_index)
            .map(|value| resolve_static_value(value, &context.initializers, &mut HashSet::new()))
    })?;
    let facts = match parts.callee_module_specifier {
        Some(module) if CORE_EMBEDDING_MODULES.contains(&module) => {
            core_embedding_facts(context, config)?
        }
        Some(module) => provider_embedding_facts(context, config, module)?,
        None => return None,
    };

    let mut metadata = Map::new();
    if parts.exported {
        metadata.insert(
            "exportName".to_string(),
            Value::String(parts.variable_name.to_string()),
        );
    }
    metadata.insert("facts".to_string(), Value::Object(facts));
    let id = format!("embedding:{}", safe_id(parts.local_name));
    Some(extracted_facts(
        parts.variable_name,
        byte_safe_embedding_definition(NativeDefinitionInput {
            id,
            kind: "embedding",
            name: parts.variable_name.to_string(),
            file: context.fingerprint_file,
            source: parts.source,
            snippet: parts.snippet,
            metadata,
        }),
        Vec::new(),
        Vec::new(),
        Vec::new(),
    ))
}
