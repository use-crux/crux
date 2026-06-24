//! Helper projections for the native injection lint read model.

use std::collections::BTreeMap;

use serde_json::{Map, Value};

use crate::index_compiler::core::facts::{NativeStaticDefinition, NativeStaticRelation};
use crate::lints::helpers::metadata_value;

pub(crate) fn injection_outgoing_relations<'a>(
    relations: &'a [NativeStaticRelation],
) -> BTreeMap<&'a str, Vec<&'a NativeStaticRelation>> {
    let mut outgoing = BTreeMap::<&str, Vec<&NativeStaticRelation>>::new();
    for relation in relations {
        if injection_relation_type(&relation.r#type) {
            outgoing
                .entry(relation.from.as_str())
                .or_default()
                .push(relation);
        }
    }
    outgoing
}

pub(crate) fn facts_use_entries(definition: &NativeStaticDefinition) -> Vec<Value> {
    metadata_value(definition, "facts")
        .and_then(|facts| facts.get("useEntries"))
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default()
}

pub(crate) fn tools_facts(definition: &NativeStaticDefinition) -> Option<Value> {
    let tools = metadata_value(definition, "facts")?.get("tools")?;
    (tools.get("hasTools").and_then(Value::as_bool) == Some(true)).then(|| tools.clone())
}

pub(crate) fn use_entry_for_target(
    owner: &NativeStaticDefinition,
    target: &NativeStaticDefinition,
    relation: &NativeStaticRelation,
) -> Option<Value> {
    facts_use_entries(owner).into_iter().find(|entry| {
        entry
            .get("targetDefinitionId")
            .and_then(Value::as_str)
            .is_some_and(|id| id == relation.to)
            || entry
                .get("variable")
                .and_then(Value::as_str)
                .is_some_and(|variable| {
                    variable == target.name
                        || metadata_value(target, "exportName").and_then(Value::as_str)
                            == Some(variable)
                        || target.id.ends_with(&format!(":{variable}"))
                })
    })
}

pub(crate) fn entry_projection(owner_definition_id: &str, entry: &Value) -> Value {
    let mut object = Map::new();
    object.insert(
        "ownerDefinitionId".to_string(),
        Value::String(owner_definition_id.to_string()),
    );
    for key in ["variable", "conditionality", "via", "branch"] {
        if let Some(value) = entry.get(key) {
            object.insert(key.to_string(), value.clone());
        }
    }
    Value::Object(object)
}

pub(crate) fn is_dynamic_use_entry(entry: &Value) -> bool {
    matches!(
        entry.get("conditionality").and_then(Value::as_str),
        Some("dynamic" | "unknown")
    ) || entry.get("via").and_then(Value::as_str) == Some("runtime")
}

pub(crate) fn combine_conditionality(
    inherited: Option<&str>,
    current: Option<&str>,
) -> Option<String> {
    if inherited.is_none() || inherited == Some("always") {
        return current.or(inherited).map(str::to_string);
    }
    inherited.map(str::to_string)
}

pub(crate) fn string_array_field(value: &Value, key: &str) -> Vec<String> {
    value
        .get(key)
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
        .map(str::to_string)
        .collect()
}

pub(crate) fn can_own_injection(kind: &str) -> bool {
    matches!(kind, "prompt" | "context" | "injectable")
}

pub(crate) fn traversable_injection_kind(kind: &str) -> bool {
    matches!(kind, "context" | "injectable")
}

fn injection_relation_type(relation_type: &str) -> bool {
    matches!(
        relation_type,
        "prompt.uses_context"
            | "prompt.uses_injectable"
            | "prompt.uses_memory"
            | "prompt.uses_blackboard"
            | "context.uses_context"
            | "context.uses_injectable"
            | "context.uses_tool"
            | "context.uses_memory"
            | "context.uses_blackboard"
            | "injectable.uses_context"
            | "injectable.uses_tool"
            | "injectable.uses_memory"
            | "injectable.uses_blackboard"
    )
}
