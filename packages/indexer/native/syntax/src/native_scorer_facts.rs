use std::collections::HashSet;

use serde_json::{Map, Value};

use crate::{
    native_definition::{NativeDefinitionInput, native_static_definition, safe_id},
    native_record_values::{
        direct_identifier, direct_string_property, has_property, json_object_property,
        number_property, property_value, resolve_static_value,
    },
    native_routing_model::{CallParts, RoutingContext, source_ref_for_callback_property},
    native_routing_output::{extracted_facts, insert_number, insert_string},
    protocol::{LiteralValue, StaticSyntaxValue},
};

pub(crate) fn scorer_facts(context: &RoutingContext<'_>, parts: &CallParts<'_>) -> Option<Value> {
    if parts.callee_name != "llmJudge" || parts.callee_direct == Some(false) {
        return None;
    }
    let config = parts.object_arg?;
    let explicit_id = direct_string_property(config, "id");
    let id = format!(
        "scorer:{}",
        safe_id(
            &explicit_id
                .clone()
                .unwrap_or_else(|| parts.local_name.to_string())
        )
    );
    let model =
        direct_string_property(config, "model").or_else(|| identifier_property(config, "model"));
    let threshold = number_property(config, "threshold", &context.initializers);
    let temperature = number_property(config, "temperature", &context.initializers);
    let samples = number_property(config, "samples", &context.initializers)
        .or_else(|| number_property(config, "sampleCount", &context.initializers));
    let scale = resolved_object_property(config, "scale", context);
    let scale_min = scale.and_then(|value| number_property(value, "min", &context.initializers));
    let scale_max = scale.and_then(|value| number_property(value, "max", &context.initializers));
    let chain_of_thought = boolean_property(config, "chainOfThought", context);
    let settings =
        json_object_property(config, Some("settings"), &context.initializers).unwrap_or(None);
    let has_rubric = has_property(config, "rubric");
    let has_detail_schema = has_property(config, "detailSchema");

    let mut facts = Map::new();
    facts.insert("kind".to_string(), Value::String("scorer".to_string()));
    facts.insert(
        "scorerId".to_string(),
        Value::String(
            explicit_id
                .clone()
                .unwrap_or_else(|| parts.variable_name.to_string()),
        ),
    );
    insert_string(&mut facts, "model", model.clone());
    insert_number(&mut facts, "threshold", threshold);
    insert_number(&mut facts, "scaleMin", scale_min);
    insert_number(&mut facts, "scaleMax", scale_max);
    if has_rubric {
        facts.insert("hasRubric".to_string(), Value::Bool(true));
    }
    if has_detail_schema {
        facts.insert("hasDetailSchema".to_string(), Value::Bool(true));
    }
    if let Some(value) = chain_of_thought {
        facts.insert("chainOfThought".to_string(), Value::Bool(value));
    }
    insert_string(
        &mut facts,
        "criteriaPreview",
        direct_string_property(config, "criteria").map(criteria_preview),
    );

    let configuration = scorer_configuration(ScorerConfigurationInput {
        model,
        threshold,
        temperature,
        samples,
        scale_min,
        scale_max,
        has_rubric,
        has_detail_schema,
        chain_of_thought,
        settings: settings.clone(),
    });

    let mut metadata = Map::new();
    metadata.insert(
        "exportName".to_string(),
        Value::String(parts.variable_name.to_string()),
    );
    metadata.insert("facts".to_string(), Value::Object(facts));
    if !configuration.is_empty() {
        metadata.insert("configuration".to_string(), Value::Object(configuration));
    }
    if let Some(settings) = settings {
        metadata.insert("settings".to_string(), settings);
    }

    let source_refs = ["score", "evaluate", "run", "judge"]
        .into_iter()
        .map(|property| {
            source_ref_for_callback_property(context, &id, config, property, "validator")
        })
        .collect::<Option<Vec<_>>>()?
        .into_iter()
        .flatten()
        .collect();

    Some(extracted_facts(
        parts.variable_name,
        native_static_definition(NativeDefinitionInput {
            id,
            kind: "scorer",
            name: explicit_id.unwrap_or_else(|| parts.variable_name.to_string()),
            file: context.file,
            source: parts.source,
            snippet: parts.snippet,
            metadata,
        }),
        Vec::new(),
        Vec::new(),
        source_refs,
    ))
}

struct ScorerConfigurationInput {
    model: Option<String>,
    threshold: Option<f64>,
    temperature: Option<f64>,
    samples: Option<f64>,
    scale_min: Option<f64>,
    scale_max: Option<f64>,
    has_rubric: bool,
    has_detail_schema: bool,
    chain_of_thought: Option<bool>,
    settings: Option<Value>,
}

fn scorer_configuration(input: ScorerConfigurationInput) -> Map<String, Value> {
    let mut configuration = Map::new();
    insert_string(&mut configuration, "model", input.model);
    insert_number(&mut configuration, "threshold", input.threshold);
    insert_number(&mut configuration, "temperature", input.temperature);
    insert_number(&mut configuration, "samples", input.samples);
    if input.scale_min.is_some() || input.scale_max.is_some() {
        let mut scale = Map::new();
        insert_number(&mut scale, "min", input.scale_min);
        insert_number(&mut scale, "max", input.scale_max);
        configuration.insert("scale".to_string(), Value::Object(scale));
    }
    if input.has_rubric {
        configuration.insert("rubric".to_string(), Value::Bool(true));
    }
    if input.has_detail_schema {
        configuration.insert("detailSchema".to_string(), Value::Bool(true));
    }
    if let Some(value) = input.chain_of_thought {
        configuration.insert("chainOfThought".to_string(), Value::Bool(value));
    }
    if let Some(settings) = input.settings {
        configuration.insert("settings".to_string(), settings);
    }
    configuration
}

fn identifier_property(config: &StaticSyntaxValue, property: &str) -> Option<String> {
    property_value(config, property).and_then(direct_identifier)
}

fn resolved_object_property<'a>(
    config: &'a StaticSyntaxValue,
    property: &str,
    context: &RoutingContext<'a>,
) -> Option<&'a StaticSyntaxValue> {
    let value = property_value(config, property)?;
    match resolve_static_value(value, &context.initializers, &mut HashSet::new()) {
        value @ StaticSyntaxValue::Object { .. } => Some(value),
        _ => None,
    }
}

fn boolean_property(
    config: &StaticSyntaxValue,
    property: &str,
    context: &RoutingContext<'_>,
) -> Option<bool> {
    let value = property_value(config, property)?;
    match resolve_static_value(value, &context.initializers, &mut HashSet::new()) {
        StaticSyntaxValue::Literal {
            value: LiteralValue::Boolean(value),
        } => Some(*value),
        _ => None,
    }
}

fn criteria_preview(value: String) -> String {
    if value.chars().count() > 240 {
        format!("{}...", value.chars().take(237).collect::<String>())
    } else {
        value
    }
}
