use serde_json::{Map, Value, json};

use crate::{
    native_definition::{NativeDefinitionInput, native_static_definition, safe_id},
    native_record_values::{
        direct_identifier, direct_string_property, property_value, resolve_static_value,
    },
    native_routing_model::{CallParts, RoutingContext, source_ref_for_callback_property},
    native_routing_output::{extracted_facts, insert_string},
    protocol::{LiteralValue, StaticSyntaxValue},
};

pub(crate) fn safety_facts(context: &RoutingContext<'_>, parts: &CallParts<'_>) -> Option<Value> {
    if parts.callee_direct == Some(false) {
        return None;
    }
    match parts.callee_name {
        "constraint" => constraint_facts(context, parts),
        "guardrail" => guardrail_facts(context, parts),
        _ => None,
    }
}

fn constraint_facts(context: &RoutingContext<'_>, parts: &CallParts<'_>) -> Option<Value> {
    let config = parts.object_arg?;
    let explicit_name = direct_string_property(config, "name");
    let local_id = explicit_name
        .clone()
        .unwrap_or_else(|| parts.local_name.to_string());
    let id = format!("constraint:{}", safe_id(&local_id));
    let targets = applies_to_refs(config, context);

    let mut facts = Map::new();
    facts.insert("kind".to_string(), Value::String("constraint".to_string()));
    insert_string(
        &mut facts,
        "severity",
        direct_string_property(config, "severity"),
    );
    if let Some(applies_to) = targets.metadata.clone() {
        facts.insert("appliesTo".to_string(), applies_to);
    }

    let mut metadata = Map::new();
    metadata.insert(
        "exportName".to_string(),
        Value::String(parts.variable_name.to_string()),
    );
    insert_string(
        &mut metadata,
        "severity",
        direct_string_property(config, "severity"),
    );
    if let Some(applies_to) = targets.metadata {
        metadata.insert("appliesTo".to_string(), applies_to);
    }
    metadata.insert("facts".to_string(), Value::Object(facts));

    safety_output(
        context,
        parts,
        config,
        id,
        "constraint",
        explicit_name.unwrap_or_else(|| parts.variable_name.to_string()),
        "validator",
        targets.refs,
    )
    .map(|definition| {
        extracted_facts(
            parts.variable_name,
            native_static_definition(NativeDefinitionInput {
                id: definition.id,
                kind: definition.kind,
                name: definition.name,
                file: context.file,
                source: parts.source,
                snippet: parts.snippet,
                metadata,
            }),
            Vec::new(),
            definition.references,
            definition.source_refs,
        )
    })
}

fn guardrail_facts(context: &RoutingContext<'_>, parts: &CallParts<'_>) -> Option<Value> {
    let config = parts.object_arg?;
    let explicit_name = direct_string_property(config, "name");
    let local_id = explicit_name
        .clone()
        .unwrap_or_else(|| parts.local_name.to_string());
    let id = format!("guardrail:{}", safe_id(&local_id));
    let targets = applies_to_refs(config, context);
    let phase = direct_string_property(config, "phase");

    let mut facts = Map::new();
    facts.insert("kind".to_string(), Value::String("guardrail".to_string()));
    insert_string(&mut facts, "policy", phase.clone());
    if let Some(applies_to) = targets.metadata.clone() {
        facts.insert("appliesTo".to_string(), applies_to);
    }

    let mut metadata = Map::new();
    metadata.insert(
        "exportName".to_string(),
        Value::String(parts.variable_name.to_string()),
    );
    insert_string(&mut metadata, "phase", phase);
    if let Some(applies_to) = targets.metadata {
        metadata.insert("appliesTo".to_string(), applies_to);
    }
    metadata.insert("facts".to_string(), Value::Object(facts));

    safety_output(
        context,
        parts,
        config,
        id,
        "guardrail",
        explicit_name.unwrap_or_else(|| parts.variable_name.to_string()),
        "policy",
        targets.refs,
    )
    .map(|definition| {
        extracted_facts(
            parts.variable_name,
            native_static_definition(NativeDefinitionInput {
                id: definition.id,
                kind: definition.kind,
                name: definition.name,
                file: context.file,
                source: parts.source,
                snippet: parts.snippet,
                metadata,
            }),
            Vec::new(),
            definition.references,
            definition.source_refs,
        )
    })
}

struct SafetyOutput<'a> {
    id: String,
    kind: &'a str,
    name: String,
    references: Vec<Value>,
    source_refs: Vec<Value>,
}

fn safety_output<'a>(
    context: &RoutingContext<'_>,
    _parts: &CallParts<'_>,
    config: &StaticSyntaxValue,
    id: String,
    kind: &'a str,
    name: String,
    role: &str,
    refs: Vec<Value>,
) -> Option<SafetyOutput<'a>> {
    let source_refs = ["check", "run", "validate", "evaluate"]
        .into_iter()
        .map(|property| source_ref_for_callback_property(context, &id, config, property, role))
        .collect::<Option<Vec<_>>>()?
        .into_iter()
        .flatten()
        .collect();
    let references = refs
        .into_iter()
        .map(|mut target| {
            if let Some(object) = target.as_object_mut() {
                object.insert(
                    "type".to_string(),
                    Value::String(format!("{kind}.applies_to")),
                );
            }
            target
        })
        .collect::<Vec<_>>();
    Some(SafetyOutput {
        id,
        kind,
        name,
        references,
        source_refs,
    })
}

struct AppliesToRefs {
    refs: Vec<Value>,
    metadata: Option<Value>,
}

fn applies_to_refs(config: &StaticSyntaxValue, context: &RoutingContext<'_>) -> AppliesToRefs {
    let mut refs = Vec::new();
    let mut metadata = Vec::new();
    for name in ["appliesTo", "target", "targets", "for"] {
        if let Some(single) = identifier_property(config, name) {
            metadata.push(Value::String(single.clone()));
            refs.push(json!({ "toVariable": single }));
        }
        for item in identifier_array_property(config, name, context) {
            metadata.push(Value::String(item.clone()));
            refs.push(json!({ "toVariable": item }));
        }
        for item in string_array_property(config, name) {
            metadata.push(Value::String(item.clone()));
            refs.push(if item.contains(':') {
                json!({ "toId": item })
            } else {
                json!({ "toVariable": item })
            });
        }
    }
    AppliesToRefs {
        refs,
        metadata: (!metadata.is_empty()).then_some(Value::Array(metadata)),
    }
}

fn identifier_property(config: &StaticSyntaxValue, property: &str) -> Option<String> {
    property_value(config, property).and_then(direct_identifier)
}

fn identifier_array_property(
    config: &StaticSyntaxValue,
    property: &str,
    context: &RoutingContext<'_>,
) -> Vec<String> {
    let Some(value) = property_value(config, property) else {
        return Vec::new();
    };
    match resolve_static_value(value, &context.initializers, &mut Default::default()) {
        StaticSyntaxValue::Array { elements } => elements
            .iter()
            .filter_map(direct_identifier)
            .collect::<Vec<_>>(),
        _ => Vec::new(),
    }
}

fn string_array_property(config: &StaticSyntaxValue, property: &str) -> Vec<String> {
    let Some(StaticSyntaxValue::Array { elements }) = property_value(config, property) else {
        return Vec::new();
    };
    elements
        .iter()
        .filter_map(|element| match element {
            StaticSyntaxValue::Literal {
                value: LiteralValue::String(value),
            } => Some(value.clone()),
            _ => None,
        })
        .collect()
}
