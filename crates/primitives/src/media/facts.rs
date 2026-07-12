use serde_json::{Map, Value, json};

use crate::{
    context::{CallParts, PrimitiveContext},
    definition::{NativeDefinitionInput, safe_id, static_index_definition},
    protocol::{LiteralValue, StaticSyntaxValue},
    record_values::{
        direct_string_property, number_property, object_value, property_value, reference_property,
        resolve_static_value,
    },
    routing::output::extracted_facts,
};

pub(crate) fn media_operation_facts(
    context: &PrimitiveContext<'_>,
    parts: &CallParts<'_>,
) -> Option<Value> {
    let config = parts
        .object_arg
        .or_else(|| parts.args.first())
        .and_then(object_value);
    let proven_input = media_modalities(config, context);
    let (input, output) = match parts.callee_name {
        "generateImage" => (None, Some(json!(["image"]))),
        "transcribe" => (Some(json!(["audio"])), Some(json!(["text"]))),
        "generateSpeech" => (Some(json!(["text"])), Some(json!(["audio"]))),
        "describe" => (
            (!proven_input.is_empty()).then(|| json!(proven_input)),
            Some(json!(["text"])),
        ),
        "generate" | "stream" if !proven_input.is_empty() => {
            (Some(json!(proven_input)), Some(json!(["text"])))
        }
        _ => return None,
    };
    let mut facts = Map::new();
    facts.insert("kind".into(), json!("media.operation"));
    facts.insert("operation".into(), json!(parts.callee_name));
    if let Some(input) = input {
        facts.insert("inputModalities".into(), input);
    }
    if let Some(output) = output {
        facts.insert("outputModalities".into(), output);
    }
    for property in ["adapter", "model"] {
        if let Some(value) = config.and_then(|value| direct_string_property(value, property)) {
            facts.insert(property.into(), Value::String(value));
        }
    }
    facts.insert(
        "execution".into(),
        config
            .and_then(|value| direct_string_property(value, "execution"))
            .filter(|value| matches!(value.as_str(), "native" | "composed" | "unknown"))
            .map(Value::String)
            .unwrap_or_else(|| json!("unknown")),
    );
    if let Some(options) = config.and_then(|value| authored_options(value, context)) {
        facts.insert("authoredOptions".into(), options);
    }

    let mut metadata = Map::new();
    if parts.exported {
        metadata.insert("exportName".into(), json!(parts.variable_name));
    }
    metadata.insert("facts".into(), Value::Object(facts));
    metadata.insert(
        "indexPresentation".into(),
        if nested_operation(parts) {
            json!({ "standalone": false, "role": "operation" })
        } else {
            json!({ "standalone": true })
        },
    );
    let mut definition = static_index_definition(NativeDefinitionInput {
        id: format!("media.operation:{}", safe_id(parts.variable_name)),
        kind: "media.operation",
        name: parts.variable_name.to_string(),
        file: context.file,
        source: parts.source,
        snippet: parts.snippet,
        metadata,
    });
    definition.as_object_mut()?.remove("sourceSnippet");
    Some(extracted_facts(
        parts.variable_name,
        definition,
        Vec::new(),
        media_relations(config, parts, context),
        Vec::new(),
    ))
}

fn media_modalities(
    config: Option<&StaticSyntaxValue>,
    context: &PrimitiveContext<'_>,
) -> Vec<&'static str> {
    let mut found = std::collections::HashSet::new();
    if let Some(config) = config {
        collect_modalities(config, context, &mut found);
    }
    ["text", "image", "audio", "video", "document"]
        .into_iter()
        .filter(|value| found.contains(value))
        .collect()
}

fn collect_modalities(
    value: &StaticSyntaxValue,
    context: &PrimitiveContext<'_>,
    found: &mut std::collections::HashSet<&'static str>,
) {
    match value {
        StaticSyntaxValue::Array { elements } => {
            for element in elements {
                collect_modalities(element, context, found);
            }
        }
        StaticSyntaxValue::Object { properties, .. } => {
            for property in properties
                .iter()
                .filter(|property| property.spread != Some(true))
            {
                if matches!(property.name.as_str(), "type" | "kind") {
                    if let StaticSyntaxValue::Literal {
                        value: LiteralValue::String(value),
                    } = &property.value
                    {
                        let modality = if value == "file" {
                            "document"
                        } else {
                            value.as_str()
                        };
                        if let Some(modality) = ["text", "image", "audio", "video", "document"]
                            .into_iter()
                            .find(|allowed| *allowed == modality)
                        {
                            found.insert(modality);
                        }
                    }
                }
                collect_modalities(&property.value, context, found);
            }
        }
        StaticSyntaxValue::Identifier { name } => {
            let resolved = resolve_static_value(
                value,
                &context.initializers,
                &mut std::collections::HashSet::new(),
            );
            if !matches!(resolved, StaticSyntaxValue::Identifier { name: resolved_name } if resolved_name == name)
            {
                collect_modalities(resolved, context, found);
            }
        }
        _ => {}
    }
}

fn authored_options(config: &StaticSyntaxValue, context: &PrimitiveContext<'_>) -> Option<Value> {
    let mut options = Map::new();
    for property in ["n", "seed"] {
        if let Some(value) = number_property(config, property, &context.initializers) {
            options.insert(property.into(), json!(value));
        }
    }
    for property in ["size", "aspectRatio", "timestamps", "taskType", "voice"] {
        if let Some(value) = direct_string_property(config, property) {
            options.insert(property.into(), Value::String(value));
        }
    }
    if let Some(StaticSyntaxValue::Literal {
        value: LiteralValue::Boolean(value),
    }) = property_value(config, "diarization")
    {
        options.insert("diarization".into(), Value::Bool(*value));
    }
    (!options.is_empty()).then_some(Value::Object(options))
}

fn nested_operation(parts: &CallParts<'_>) -> bool {
    parts
        .variable_name
        .strip_prefix(parts.callee_name)
        .is_some_and(|suffix| {
            suffix.starts_with('-') && suffix[1..].chars().all(|char| char.is_ascii_digit())
        })
}

fn media_relations(
    config: Option<&StaticSyntaxValue>,
    parts: &CallParts<'_>,
    context: &PrimitiveContext<'_>,
) -> Vec<Value> {
    let mut relations = Vec::new();
    if let Some(owner) = parts.owner_variable_name {
        relations.push(json!({ "type": "media.owner", "toVariable": owner }));
    }
    for (relation, property) in [
        ("media.uses_prompt", "prompt"),
        ("media.uses_routing", "routing"),
        ("media.evaluation_target", "evaluation"),
        ("media.uses_storage", "storage"),
    ] {
        if let Some(target) =
            config.and_then(|value| reference_property(value, property, &context.initializers))
        {
            relations.push(json!({ "type": relation, "toVariable": target }));
        }
    }
    relations
}
