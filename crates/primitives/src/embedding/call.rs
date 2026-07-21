use std::collections::HashSet;

use serde_json::{Map, Value, json};

use crate::{
    context::{CallParts, PrimitiveContext},
    definition::{NativeDefinitionInput, safe_id},
    embedding::safe_definition::byte_safe_embedding_definition,
    protocol::{LiteralValue, StaticSyntaxValue},
    record_values::{direct_string_property, resolve_static_value},
    routing::output::extracted_facts,
};

const FACTORY_MODULES: &[&str] = &[
    "@use-crux/core",
    "@use-crux/core/embedding",
    "@use-crux/google",
    "@use-crux/openai",
    "@use-crux/ai",
];

/// Projects a method call only when its receiver resolves to an authored embedding definition.
pub(crate) fn embedding_call_facts(
    context: &PrimitiveContext<'_>,
    parts: &CallParts<'_>,
) -> Option<Value> {
    let operation = match parts.callee_name {
        "embed" | "embedMany" => parts.callee_name,
        _ => return None,
    };
    let receiver = parts.receiver_name?;
    let receiver_value = StaticSyntaxValue::Identifier {
        name: receiver.to_string(),
    };
    let resolved = context.resolve_record_source(Some(&receiver_value))??;
    let StaticSyntaxValue::Call { callee, .. } = resolved.value else {
        return None;
    };
    if callee.name != "embedding"
        || !callee
            .module_specifier
            .as_deref()
            .is_some_and(|module| FACTORY_MODULES.contains(&module))
    {
        return None;
    }

    let id = format!(
        "embedding.call:{}",
        safe_id(&format!(
            "{}:{}:{}",
            context.fingerprint_file, parts.source.line, parts.source.column
        ))
    );
    let target_id = format!(
        "embedding:{}",
        safe_id(&format!(
            "{}:{}",
            resolved.fingerprint_file, resolved.definition_symbol
        ))
    );
    let mut call_facts = Map::new();
    call_facts.insert(
        "kind".to_string(),
        Value::String("embedding.call".to_string()),
    );
    call_facts.insert(
        "operation".to_string(),
        Value::String(operation.to_string()),
    );
    if let Some(modalities) = input_modalities(parts.args.first(), context) {
        call_facts.insert("modalities".to_string(), json!(modalities));
    }
    if let Some(role) = parts.args.get(1).and_then(|value| {
        direct_string_property(
            resolve_static_value(value, &context.initializers, &mut HashSet::new()),
            "role",
        )
    }) && matches!(role.as_str(), "query" | "document")
    {
        call_facts.insert("role".to_string(), Value::String(role));
    }

    let mut metadata = Map::new();
    metadata.insert("facts".to_string(), Value::Object(call_facts));
    Some(extracted_facts(
        parts.variable_name,
        byte_safe_embedding_definition(NativeDefinitionInput {
            id,
            kind: "embedding.call",
            name: operation.to_string(),
            file: context.fingerprint_file,
            source: parts.source,
            snippet: parts.snippet,
            metadata,
        }),
        Vec::new(),
        vec![json!({
            "type": "embedding.call.uses_embedding",
            "toId": target_id,
        })],
        Vec::new(),
    ))
}

fn input_modalities(
    value: Option<&StaticSyntaxValue>,
    context: &PrimitiveContext<'_>,
) -> Option<Vec<&'static str>> {
    let value = resolve_static_value(value?, &context.initializers, &mut HashSet::new());
    match value {
        StaticSyntaxValue::Literal {
            value: LiteralValue::String(_),
        } => Some(vec!["text"]),
        StaticSyntaxValue::Object { .. } => {
            if let Some(modality) = direct_string_property(value, "type") {
                match modality.as_str() {
                    "text" => return Some(vec!["text"]),
                    "image" => return Some(vec!["image"]),
                    "audio" => return Some(vec!["audio"]),
                    "video" => return Some(vec!["video"]),
                    "document" | "file" => return Some(vec!["document"]),
                    _ => {}
                }
            }
            media_type_modality(direct_string_property(value, "mediaType").as_deref())
                .map(|modality| vec![modality])
        }
        StaticSyntaxValue::Array { elements } => {
            let mut modalities = Vec::new();
            for element in elements {
                for modality in input_modalities(Some(element), context)? {
                    if !modalities.contains(&modality) {
                        modalities.push(modality);
                    }
                }
            }
            Some(modalities)
        }
        _ => None,
    }
}

fn media_type_modality(media_type: Option<&str>) -> Option<&'static str> {
    let media_type = media_type?
        .split(';')
        .next()
        .map(str::trim)
        .filter(|value| !value.is_empty())?
        .to_ascii_lowercase();
    if media_type.starts_with("image/") {
        return Some("image");
    }
    if media_type.starts_with("audio/") {
        return Some("audio");
    }
    if media_type.starts_with("video/") {
        return Some("video");
    }
    Some("document")
}
