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
    if let Some(adapter) = adapter_for_module(parts.callee_module_specifier) {
        facts.insert("adapter".into(), Value::String(adapter.into()));
    }
    if let Some(model) = config.and_then(|value| direct_string_property(value, "model")) {
        facts.insert("model".into(), Value::String(model));
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
        file: context.fingerprint_file,
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

fn adapter_for_module(module_specifier: Option<&str>) -> Option<&'static str> {
    match module_specifier {
        Some("@use-crux/ai") => Some("ai-sdk"),
        Some("@use-crux/openai") => Some("openai"),
        Some("@use-crux/google") => Some("google"),
        Some("@use-crux/anthropic") => Some("anthropic"),
        Some("@use-crux/convex") => Some("convex"),
        _ => None,
    }
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
    for property in ["size", "aspectRatio", "timestamps", "voice"] {
        if let Some(value) = direct_string_property(config, property) {
            options.insert(property.into(), Value::String(value));
        }
    }
    if let Some(task) = transcription_task(config) {
        options.insert("task".into(), Value::String(task.into()));
    }
    if let Some(StaticSyntaxValue::Literal {
        value: LiteralValue::Boolean(value),
    }) = property_value(config, "diarization")
    {
        options.insert("diarization".into(), Value::Bool(*value));
    }
    (!options.is_empty()).then_some(Value::Object(options))
}

fn transcription_task(config: &StaticSyntaxValue) -> Option<&'static str> {
    match property_value(config, "task") {
        Some(StaticSyntaxValue::Literal {
            value: LiteralValue::String(task),
        }) if task == "transcribe" => Some("transcribe"),
        Some(task) if direct_string_property(task, "type").as_deref() == Some("translate") => {
            Some("translate")
        }
        _ => None,
    }
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
    if matches!(parts.callee_name, "generate" | "stream") {
        if let Some(StaticSyntaxValue::Identifier { name }) = parts.args.first() {
            relations.push(json!({ "type": "media.uses_prompt", "toVariable": name }));
        }
    }
    for (relation, property) in [
        ("media.uses_routing", "model"),
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
