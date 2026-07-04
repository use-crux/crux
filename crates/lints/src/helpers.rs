//! Shared predicates for native built-in graph lints.

use std::collections::{BTreeMap, BTreeSet};

use serde_json::Value;

use crate::facts::{StaticIndexDefinition, StaticIndexRelation};

pub(crate) const COVERAGE_TARGET_KINDS: &[&str] = &[
    "prompt",
    "agent",
    "flow",
    "rag.recipe",
    "rag.pipeline",
    "composition.parallel",
    "composition.pipeline",
    "composition.swarm",
    "composition.consensus",
    "routing.router",
    "routing.cascade",
    "routing.fallback",
];

pub(crate) const PROPAGATING_RELATION_TYPES: &[&str] = &[
    "prompt.uses_context",
    "agent.uses_prompt",
    "agent.uses_tool",
    "agent.can_handoff_to",
    "flow.includes_step",
    "flow.step.uses_agent",
    "flow.step.uses_tool",
    "flow.step.uses_prompt",
    "flow.step.uses_memory",
    "flow.step.uses_blackboard",
    "composition.uses_agent",
    "composition.uses_flow",
    "composition.uses_prompt",
    "composition.uses_tool",
    "parallel.includes_branch",
    "parallel.branch.uses_agent",
    "parallel.branch.uses_flow",
    "parallel.branch.uses_prompt",
    "parallel.branch.uses_tool",
    "pipeline.includes_stage",
    "pipeline.stage.uses_agent",
    "pipeline.stage.uses_flow",
    "pipeline.stage.uses_prompt",
    "pipeline.stage.uses_tool",
    "consensus.includes_agent",
    "consensus.uses_judge",
    "consensus.uses_scorer",
    "swarm.includes_agent",
    "swarm.coordinated_by",
    "swarm.uses_blackboard",
    "swarm.uses_memory",
    "blackboard.uses_store",
    "workspace.exposes_tool",
    "router.includes_route",
    "router.route.uses_router",
    "router.route.uses_cascade",
    "router.route.uses_fallback",
    "router.route.uses_agent",
    "router.route.uses_prompt",
    "cascade.includes_tier",
    "cascade.tier.uses_router",
    "cascade.tier.uses_cascade",
    "cascade.tier.uses_fallback",
    "cascade.tier.uses_agent",
    "cascade.tier.uses_prompt",
    "fallback.includes_option",
    "fallback.option.uses_router",
    "fallback.option.uses_cascade",
    "fallback.option.uses_fallback",
    "fallback.option.uses_agent",
    "fallback.option.uses_prompt",
    "agent.uses_routing",
    "flow.step.uses_routing",
    "composition.uses_routing",
    "parallel.branch.uses_routing",
    "pipeline.stage.uses_routing",
];

pub(crate) fn covered_definition_ids(
    definitions: &[StaticIndexDefinition],
    relations: &[StaticIndexRelation],
) -> BTreeSet<String> {
    let mut covered = relations
        .iter()
        .filter(|relation| relation.r#type == "eval.covers_definition")
        .map(|relation| relation.to.clone())
        .collect::<BTreeSet<_>>();
    for definition in definitions {
        let Some(quality) = definition.quality.as_ref() else {
            continue;
        };
        if [
            "evalIds",
            "affectedEvalIds",
            "suiteIds",
            "affectedSuiteIds",
            "experimentIds",
            "baselineIds",
        ]
        .iter()
        .any(|key| has_items(quality.get(*key)))
        {
            covered.insert(definition.id.clone());
        }
    }
    covered
}

pub(crate) fn should_require_coverage(definition: &StaticIndexDefinition) -> bool {
    definition.status.as_deref() != Some("missing")
        && COVERAGE_TARGET_KINDS.contains(&definition.kind.as_str())
}

pub(crate) fn targets_by_relation(
    relations: &[StaticIndexRelation],
    relation_type: &str,
) -> BTreeSet<String> {
    relations
        .iter()
        .filter(|relation| relation.r#type == relation_type)
        .map(|relation| relation.to.clone())
        .collect()
}

pub(crate) fn relation_sources(
    relations: &[StaticIndexRelation],
    relation_types: &[&str],
) -> BTreeSet<String> {
    relations
        .iter()
        .filter(|relation| relation_types.contains(&relation.r#type.as_str()))
        .map(|relation| relation.from.clone())
        .collect()
}

pub(crate) fn relations_by_source<'a>(
    relations: &'a [StaticIndexRelation],
) -> BTreeMap<&'a str, Vec<&'a StaticIndexRelation>> {
    let mut by_source = BTreeMap::<&str, Vec<&StaticIndexRelation>>::new();
    for relation in relations {
        by_source
            .entry(relation.from.as_str())
            .or_default()
            .push(relation);
    }
    by_source
}

pub(crate) fn child_definitions_by_parent<'a>(
    definitions: &'a [StaticIndexDefinition],
    kind: &str,
    metadata_key: &str,
) -> BTreeMap<String, Vec<&'a StaticIndexDefinition>> {
    let mut by_parent = BTreeMap::<String, Vec<&StaticIndexDefinition>>::new();
    for definition in definitions {
        if definition.kind != kind {
            continue;
        }
        let Some(parent_id) = metadata_str(definition, metadata_key) else {
            continue;
        };
        by_parent
            .entry(parent_id.to_string())
            .or_default()
            .push(definition);
    }
    for list in by_parent.values_mut() {
        list.sort_by(|left, right| {
            numeric_metadata(left, "tierIndex").cmp(&numeric_metadata(right, "tierIndex"))
        });
    }
    by_parent
}

pub(crate) fn workspace_allows_writes(definition: &StaticIndexDefinition) -> bool {
    if metadata_value(definition, "hasTools").and_then(Value::as_bool) == Some(true) {
        return true;
    }
    metadata_value(definition, "mounts")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .any(|mount| {
            let access = mount
                .get("access")
                .or_else(|| mount.get("mode"))
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_ascii_lowercase();
            ["write", "edit", "delete", "rw", "readwrite"]
                .iter()
                .any(|needle| access.contains(needle))
        })
}

pub(crate) fn has_conflict_policy(definition: &StaticIndexDefinition) -> bool {
    metadata_str(definition, "conflictPolicy").is_some_and(|value| !value.is_empty())
}

pub(crate) fn memory_is_long_lived(definition: &StaticIndexDefinition) -> bool {
    !long_lived_memory_blocks(definition).is_empty()
}

pub(crate) fn has_retention_policy(definition: &StaticIndexDefinition) -> bool {
    metadata_str(definition, "evictionPolicy").is_some_and(|value| !value.is_empty())
}

pub(crate) fn long_lived_memory_blocks(definition: &StaticIndexDefinition) -> Vec<Value> {
    metadata_value(definition, "blocks")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter(|block| {
            block.get("hasEmbed").and_then(Value::as_bool) == Some(true)
                || block
                    .get("kind")
                    .and_then(Value::as_str)
                    .is_some_and(|kind| {
                        ["episodes", "facts", "procedures", "reflections"].contains(&kind)
                    })
        })
        .cloned()
        .collect()
}

pub(crate) fn metadata_value<'a>(
    definition: &'a StaticIndexDefinition,
    key: &str,
) -> Option<&'a Value> {
    definition.metadata.as_ref()?.get(key)
}

pub(crate) fn metadata_str<'a>(
    definition: &'a StaticIndexDefinition,
    key: &str,
) -> Option<&'a str> {
    metadata_value(definition, key).and_then(Value::as_str)
}

pub(crate) fn metadata_path<'a>(
    definition: &'a StaticIndexDefinition,
    path: &[&str],
) -> Option<&'a Value> {
    let mut current = definition.metadata.as_ref()?;
    for key in path {
        current = current.get(*key)?;
    }
    Some(current)
}

pub(crate) fn has_items(value: Option<&Value>) -> bool {
    value
        .and_then(Value::as_array)
        .is_some_and(|items| !items.is_empty())
}

pub(crate) fn is_record(value: Option<&Value>) -> bool {
    value.is_some_and(|value| value.is_object())
}

pub(crate) fn numeric_metadata(definition: &StaticIndexDefinition, key: &str) -> usize {
    metadata_value(definition, key)
        .and_then(Value::as_u64)
        .map(|value| value as usize)
        .unwrap_or(usize::MAX)
}

pub(crate) fn owned_string_array(values: impl IntoIterator<Item = String>) -> Value {
    Value::Array(values.into_iter().map(Value::String).collect())
}
