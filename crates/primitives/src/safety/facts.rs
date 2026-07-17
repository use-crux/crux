use serde_json::{Map, Value, json};

use crate::{
    context::{CallParts, PrimitiveContext, source_ref_for_callback_property},
    definition::{NativeDefinitionInput, safe_id, static_index_definition},
    protocol::{LiteralValue, StaticSyntaxValue},
    record_values::{
        direct_identifier, direct_string_property, property_value, resolve_static_value,
    },
    routing::output::{extracted_facts, insert_string},
    safety::metadata::{
        constraint_strategy_facts, guardrail_strategy_facts, policy_id_for, safety_boundaries,
    },
};

pub(crate) fn safety_facts(context: &PrimitiveContext<'_>, parts: &CallParts<'_>) -> Option<Value> {
    if parts.callee_direct == Some(false) {
        return None;
    }
    match parts.callee_name {
        "constraint" => constraint_facts(context, parts),
        "guardrail" => guardrail_facts(context, parts),
        _ => None,
    }
}

fn constraint_facts(context: &PrimitiveContext<'_>, parts: &CallParts<'_>) -> Option<Value> {
    let config = parts.object_arg?;
    let policy_id = policy_id_for(config, parts.local_name);
    let id = format!("constraint:{}", safe_id(&policy_id));
    let targets = applies_to_refs(config, context);
    let boundaries = safety_boundaries(config);
    let boundary = boundaries.first().cloned();
    let strategy = constraint_strategy_facts(config, &context.initializers);

    let mut facts = Map::new();
    facts.insert("kind".to_string(), Value::String("constraint".to_string()));
    facts.insert("policyId".to_string(), Value::String(policy_id.clone()));
    insert_string(
        &mut facts,
        "severity",
        direct_string_property(config, "severity"),
    );
    if let Some(boundary) = boundary.clone() {
        facts.insert("boundary".to_string(), Value::String(boundary));
    }
    insert_string_array(&mut facts, "boundaries", &boundaries);
    if let Some(applies_to) = targets.metadata.clone() {
        facts.insert("appliesTo".to_string(), applies_to);
    }
    if let Some(strategy) = strategy.clone() {
        facts.insert("strategy".to_string(), strategy);
    }

    let mut metadata = Map::new();
    metadata.insert(
        "exportName".to_string(),
        Value::String(parts.variable_name.to_string()),
    );
    metadata.insert("policyId".to_string(), Value::String(policy_id.clone()));
    insert_string(
        &mut metadata,
        "severity",
        direct_string_property(config, "severity"),
    );
    if let Some(boundary) = boundary {
        metadata.insert("boundary".to_string(), Value::String(boundary));
    }
    insert_string_array(&mut metadata, "boundaries", &boundaries);
    if let Some(applies_to) = targets.metadata {
        metadata.insert("appliesTo".to_string(), applies_to);
    }
    if let Some(strategy) = strategy {
        metadata.insert("strategy".to_string(), strategy);
    }
    metadata.insert("facts".to_string(), Value::Object(facts));

    safety_output(
        context,
        parts,
        config,
        id,
        "constraint",
        policy_id,
        "validator",
        targets.refs,
    )
    .map(|definition| {
        extracted_facts(
            parts.variable_name,
            static_index_definition(NativeDefinitionInput {
                id: definition.id,
                kind: definition.kind,
                name: definition.name,
                file: context.fingerprint_file,
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

fn guardrail_facts(context: &PrimitiveContext<'_>, parts: &CallParts<'_>) -> Option<Value> {
    let config = parts.object_arg?;
    let policy_id = policy_id_for(config, parts.local_name);
    let id = format!("guardrail:{}", safe_id(&policy_id));
    let targets = applies_to_refs(config, context);
    let phase = direct_string_property(config, "phase");
    let boundaries = safety_boundaries(config);
    let boundary = boundaries.first().cloned();
    let strategy = guardrail_strategy_facts(config, &context.initializers);

    let mut facts = Map::new();
    facts.insert("kind".to_string(), Value::String("guardrail".to_string()));
    facts.insert("policyId".to_string(), Value::String(policy_id.clone()));
    insert_string(&mut facts, "policy", phase.clone());
    if let Some(boundary) = boundary.clone() {
        facts.insert("boundary".to_string(), Value::String(boundary));
    }
    insert_string_array(&mut facts, "boundaries", &boundaries);
    if let Some(applies_to) = targets.metadata.clone() {
        facts.insert("appliesTo".to_string(), applies_to);
    }
    if let Some(strategy) = strategy.clone() {
        facts.insert("strategy".to_string(), strategy);
    }

    let mut metadata = Map::new();
    metadata.insert(
        "exportName".to_string(),
        Value::String(parts.variable_name.to_string()),
    );
    metadata.insert("policyId".to_string(), Value::String(policy_id.clone()));
    insert_string(&mut metadata, "phase", phase);
    if let Some(boundary) = boundary {
        metadata.insert("boundary".to_string(), Value::String(boundary));
    }
    insert_string_array(&mut metadata, "boundaries", &boundaries);
    insert_string(
        &mut metadata,
        "mode",
        direct_string_property(config, "mode"),
    );
    insert_string(
        &mut metadata,
        "stream",
        direct_string_property(config, "stream"),
    );
    if let Some(applies_to) = targets.metadata {
        metadata.insert("appliesTo".to_string(), applies_to);
    }
    if let Some(strategy) = strategy {
        metadata.insert("strategy".to_string(), strategy);
    }
    metadata.insert("facts".to_string(), Value::Object(facts));

    safety_output(
        context,
        parts,
        config,
        id,
        "guardrail",
        policy_id,
        "policy",
        targets.refs,
    )
    .map(|definition| {
        extracted_facts(
            parts.variable_name,
            static_index_definition(NativeDefinitionInput {
                id: definition.id,
                kind: definition.kind,
                name: definition.name,
                file: context.fingerprint_file,
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
    context: &PrimitiveContext<'_>,
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

fn applies_to_refs(config: &StaticSyntaxValue, context: &PrimitiveContext<'_>) -> AppliesToRefs {
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

fn insert_string_array(map: &mut Map<String, Value>, name: &str, values: &[String]) {
    if values.is_empty() {
        return;
    }
    map.insert(
        name.to_string(),
        Value::Array(values.iter().cloned().map(Value::String).collect()),
    );
}

fn identifier_property(config: &StaticSyntaxValue, property: &str) -> Option<String> {
    property_value(config, property).and_then(direct_identifier)
}

fn identifier_array_property(
    config: &StaticSyntaxValue,
    property: &str,
    context: &PrimitiveContext<'_>,
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
