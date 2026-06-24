//! Relation-derived Project Index read-model enrichment.
//!
//! The canonical graph edge remains `NativeStaticRelation`; this module mirrors
//! dependency bucket projection while sibling modules handle use-entry and
//! routing-specific metadata.

use std::collections::{BTreeMap, BTreeSet};

use serde_json::Value;

use crate::index_compiler::contracts::input::with_expanded_input_contracts;
use crate::index_compiler::core::facts::{NativeStaticDefinition, NativeStaticRelation};
use crate::index_compiler::read::helpers::{definition_metadata, object_entry};
use crate::index_compiler::read::injection::{
    ResolvedInjectionUseEntryTarget, with_resolved_injection_use_entry_ref_targets,
    with_resolved_injection_use_entry_targets,
};
use crate::index_compiler::read::routing::with_resolved_routing_target_metadata;
use crate::index_compiler::relation::model::string_set;

/// Applies all relation-derived metadata projections to definition facts.
#[cfg(test)]
pub(crate) fn with_resolved_relation_read_model(
    definitions: Vec<NativeStaticDefinition>,
    relations: &[NativeStaticRelation],
) -> Vec<NativeStaticDefinition> {
    with_resolved_relation_read_model_with_ref_targets(definitions, relations, &[])
}

pub(crate) fn with_resolved_relation_read_model_with_ref_targets(
    definitions: Vec<NativeStaticDefinition>,
    relations: &[NativeStaticRelation],
    use_entry_targets: &[ResolvedInjectionUseEntryTarget],
) -> Vec<NativeStaticDefinition> {
    with_expanded_input_contracts(
        with_resolved_injection_use_entry_ref_targets(
            with_resolved_injection_use_entry_targets(
                with_resolved_relation_dependency_facts(
                    with_resolved_routing_target_metadata(definitions, relations),
                    relations,
                ),
                relations,
            ),
            use_entry_targets,
        ),
        relations,
    )
}

fn with_resolved_relation_dependency_facts(
    definitions: Vec<NativeStaticDefinition>,
    relations: &[NativeStaticRelation],
) -> Vec<NativeStaticDefinition> {
    let mut dependencies_by_definition =
        BTreeMap::<String, BTreeMap<String, BTreeSet<String>>>::new();
    for relation in relations {
        let Some(key) = dependency_key_for_relation(&relation.r#type) else {
            continue;
        };
        dependencies_by_definition
            .entry(relation.from.clone())
            .or_default()
            .entry(key.to_string())
            .or_default()
            .insert(relation.to.clone());
    }

    definitions
        .into_iter()
        .map(|mut definition| {
            let Some(dependencies) = dependencies_by_definition.get(&definition.id) else {
                return definition;
            };
            let mut metadata = definition_metadata(&definition);
            let intelligence = object_entry(&mut metadata, "intelligence");
            intelligence
                .entry("confidence".to_string())
                .or_insert_with(|| Value::String("static".to_string()));
            let dependency_object = object_entry(intelligence, "dependencies");
            for (key, ids) in dependencies {
                let existing = dependency_object
                    .get(key)
                    .and_then(Value::as_array)
                    .into_iter()
                    .flatten()
                    .filter_map(|value| value.as_str().map(str::to_string));
                dependency_object.insert(
                    key.clone(),
                    Value::Array(
                        string_set(existing.chain(ids.iter().cloned()))
                            .into_iter()
                            .map(Value::String)
                            .collect(),
                    ),
                );
            }
            definition.metadata = Some(Value::Object(metadata));
            definition
        })
        .collect()
}

fn dependency_key_for_relation(relation_type: &str) -> Option<&'static str> {
    if !relation_type.starts_with("prompt.")
        && !relation_type.starts_with("context.")
        && !relation_type.starts_with("injectable.")
    {
        return None;
    }
    if relation_type.ends_with(".uses_context") {
        return Some("contexts");
    }
    if relation_type.ends_with(".uses_injectable") {
        return Some("injectables");
    }
    if relation_type.ends_with(".uses_tool") {
        return Some("tools");
    }
    if relation_type.ends_with(".uses_memory") {
        return Some("memory");
    }
    if relation_type.ends_with(".uses_blackboard") {
        return Some("blackboards");
    }
    if relation_type.ends_with(".uses_workspace") {
        return Some("workspaces");
    }
    None
}
