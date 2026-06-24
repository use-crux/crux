//! Injection use-entry relation metadata projection.

use std::collections::{BTreeMap, BTreeSet};

use serde_json::Value;

use crate::static_compiler::core::facts::{
    NativeStaticDefinition, NativeStaticFidelity, NativeStaticRelation,
};
use crate::static_compiler::read::helpers::{
    definition_export_name, definition_metadata, fidelity_json_name, object_entry,
};
use crate::static_compiler::relation::model::safe_use_entry_id;

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ResolvedInjectionUseEntryTarget {
    pub(crate) owner_definition_id: String,
    pub(crate) variable: String,
    pub(crate) target_definition_id: String,
    pub(crate) relation_type: String,
    pub(crate) relation_fidelity: NativeStaticFidelity,
}

pub(crate) fn with_resolved_injection_use_entry_targets(
    definitions: Vec<NativeStaticDefinition>,
    relations: &[NativeStaticRelation],
) -> Vec<NativeStaticDefinition> {
    let by_id = definitions
        .iter()
        .map(|definition| (definition.id.clone(), definition.clone()))
        .collect::<BTreeMap<_, _>>();
    let mut outgoing = BTreeMap::<String, Vec<NativeStaticRelation>>::new();
    for relation in relations {
        if is_injection_use_relation(&relation.r#type) {
            outgoing
                .entry(relation.from.clone())
                .or_default()
                .push(relation.clone());
        }
    }

    definitions
        .into_iter()
        .map(|mut definition| {
            let Some(candidates) = outgoing.get(&definition.id) else {
                return definition;
            };
            let mut metadata = definition_metadata(&definition);
            let Some(entries) = use_entries(&metadata) else {
                return definition;
            };
            let mut candidates = candidates.clone();
            let enriched = entries
                .into_iter()
                .map(|entry| enrich_use_entry(entry, &mut candidates, &by_id))
                .collect::<Vec<_>>();
            object_entry(&mut metadata, "facts")
                .insert("useEntries".to_string(), Value::Array(enriched));
            definition.metadata = Some(Value::Object(metadata));
            definition
        })
        .collect()
}

pub(crate) fn with_resolved_injection_use_entry_ref_targets(
    definitions: Vec<NativeStaticDefinition>,
    targets: &[ResolvedInjectionUseEntryTarget],
) -> Vec<NativeStaticDefinition> {
    if targets.is_empty() {
        return definitions;
    }
    let by_id = definitions
        .iter()
        .map(|definition| (definition.id.clone(), definition.clone()))
        .collect::<BTreeMap<_, _>>();
    let mut by_owner = BTreeMap::<String, Vec<ResolvedInjectionUseEntryTarget>>::new();
    for target in targets {
        by_owner
            .entry(target.owner_definition_id.clone())
            .or_default()
            .push(target.clone());
    }
    definitions
        .into_iter()
        .map(|mut definition| {
            let Some(targets) = by_owner.get(&definition.id) else {
                return definition;
            };
            let mut metadata = definition_metadata(&definition);
            let Some(entries) = use_entries(&metadata) else {
                return definition;
            };
            let resolved_variables = resolved_use_entry_variables(&entries);
            let enriched = entries
                .into_iter()
                .map(|entry| {
                    enrich_use_entry_from_ref_target(entry, targets, &by_id, &resolved_variables)
                })
                .collect::<Vec<_>>();
            object_entry(&mut metadata, "facts")
                .insert("useEntries".to_string(), Value::Array(enriched));
            definition.metadata = Some(Value::Object(metadata));
            definition
        })
        .collect()
}

fn enrich_use_entry(
    entry: Value,
    candidates: &mut Vec<NativeStaticRelation>,
    by_id: &BTreeMap<String, NativeStaticDefinition>,
) -> Value {
    let Some(object) = entry.as_object() else {
        return entry;
    };
    let variable = object.get("variable").and_then(Value::as_str);
    let Some(index) = matching_relation_index(variable, candidates, by_id) else {
        return entry;
    };
    let relation = candidates.remove(index);
    let target = by_id.get(&relation.to);
    let mut object = object.clone();
    if let Some(hint) = relation_hint_for_target(target.map(|definition| definition.kind.as_str()))
    {
        object.insert("relationHint".to_string(), Value::String(hint.to_string()));
    }
    object.insert(
        "targetDefinitionId".to_string(),
        Value::String(relation.to.clone()),
    );
    if let Some(target) = target {
        object.insert("targetKind".to_string(), Value::String(target.kind.clone()));
        object.insert("targetName".to_string(), Value::String(target.name.clone()));
    }
    object.insert("relationType".to_string(), Value::String(relation.r#type));
    object.insert(
        "relationFidelity".to_string(),
        Value::String(fidelity_json_name(relation.fidelity).to_string()),
    );
    Value::Object(object)
}

fn enrich_use_entry_from_ref_target(
    entry: Value,
    targets: &[ResolvedInjectionUseEntryTarget],
    by_id: &BTreeMap<String, NativeStaticDefinition>,
    resolved_variables: &BTreeSet<String>,
) -> Value {
    let Some(object) = entry.as_object() else {
        return entry;
    };
    if object.get("targetDefinitionId").is_some() {
        return entry;
    }
    let Some(variable) = object.get("variable").and_then(Value::as_str) else {
        return entry;
    };
    if resolved_variables.contains(variable) {
        return entry;
    }
    let Some(target_ref) = targets.iter().find(|target| target.variable == variable) else {
        return entry;
    };
    let target = by_id.get(&target_ref.target_definition_id);
    let mut object = object.clone();
    if let Some(hint) = relation_hint_for_target(target.map(|definition| definition.kind.as_str()))
    {
        object.insert("relationHint".to_string(), Value::String(hint.to_string()));
    }
    object.insert(
        "targetDefinitionId".to_string(),
        Value::String(target_ref.target_definition_id.clone()),
    );
    if let Some(target) = target {
        object.insert("targetKind".to_string(), Value::String(target.kind.clone()));
        object.insert("targetName".to_string(), Value::String(target.name.clone()));
    }
    object.insert(
        "relationType".to_string(),
        Value::String(target_ref.relation_type.clone()),
    );
    object.insert(
        "relationFidelity".to_string(),
        Value::String(fidelity_json_name(target_ref.relation_fidelity).to_string()),
    );
    Value::Object(object)
}

fn resolved_use_entry_variables(entries: &[Value]) -> BTreeSet<String> {
    entries
        .iter()
        .filter_map(|entry| {
            let object = entry.as_object()?;
            object.get("targetDefinitionId")?;
            object
                .get("variable")
                .and_then(Value::as_str)
                .map(str::to_string)
        })
        .collect()
}

fn matching_relation_index(
    variable: Option<&str>,
    candidates: &[NativeStaticRelation],
    by_id: &BTreeMap<String, NativeStaticDefinition>,
) -> Option<usize> {
    if let Some(variable) = variable {
        return candidates.iter().position(|relation| {
            relation_matches_use_entry(variable, relation, by_id.get(&relation.to))
        });
    }
    (!candidates.is_empty()).then_some(0)
}

fn relation_matches_use_entry(
    variable: &str,
    relation: &NativeStaticRelation,
    target: Option<&NativeStaticDefinition>,
) -> bool {
    let safe = safe_use_entry_id(variable);
    target.map(|definition| definition.name.as_str()) == Some(variable)
        || target.and_then(definition_export_name).as_deref() == Some(variable)
        || target
            .map(|definition| definition.id.ends_with(&format!(":{variable}")))
            .unwrap_or(false)
        || relation.to.ends_with(&format!(":{safe}"))
}

fn use_entries(metadata: &serde_json::Map<String, Value>) -> Option<Vec<Value>> {
    metadata
        .get("facts")
        .and_then(Value::as_object)
        .and_then(|facts| facts.get("useEntries"))
        .and_then(Value::as_array)
        .cloned()
}

fn is_injection_use_relation(relation_type: &str) -> bool {
    is_injection_use_relation_type(relation_type)
}

pub(crate) fn is_injection_use_relation_type(relation_type: &str) -> bool {
    matches!(
        relation_type,
        "prompt.uses_context"
            | "prompt.uses_injectable"
            | "prompt.uses_memory"
            | "prompt.uses_blackboard"
            | "context.uses_context"
            | "context.uses_injectable"
            | "context.uses_memory"
            | "context.uses_blackboard"
            | "injectable.uses_context"
            | "injectable.uses_memory"
            | "injectable.uses_blackboard"
    )
}

fn relation_hint_for_target(kind: Option<&str>) -> Option<&'static str> {
    match kind {
        Some("context") => Some("context"),
        Some("injectable") => Some("injectable"),
        Some("memory") => Some("memory"),
        Some("blackboard") => Some("blackboard"),
        _ => None,
    }
}
