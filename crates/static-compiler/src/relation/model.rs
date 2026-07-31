//! Relation binding and canonicalization for Static Index finalization.
//!
//! This module mirrors the TypeScript relation resolver's public contract:
//! relation identity is a normalized triple, higher-fidelity evidence replaces
//! lower-fidelity evidence, and every unbound relation reference is conserved.

use std::collections::{BTreeMap, BTreeSet};

use crate::core::facts::{
    StaticIndexDefinition, StaticIndexFidelity, StaticIndexPatchFacts, StaticIndexRelation,
    StaticIndexRelationRef, StaticIndexSourceLocation,
};
use crate::read::injection::{ResolvedInjectionUseEntryTarget, is_injection_use_relation_type};
use crate::read::model::with_resolved_relation_read_model_with_ref_targets;
use crate::relation::fallback::fallback_relation_target_id;
pub(crate) use crate::relation::fallback::safe_use_entry_id;
use crate::relation::gaps::record_policy_gap_once;
pub(crate) use crate::relation::policy::{
    StaticIndexRelationPolicyTable, relation_policy_table_from_value_with_builtins,
};
#[cfg(test)]
pub(crate) use crate::relation::policy::{
    built_in_relation_policy_table, relation_policy_table_from_value,
};
use crate::relation::report::{
    StaticIndexRelationFactRef, StaticIndexRelationPolicyGap, StaticIndexRelationResolutionReport,
    fact_ref, relation_diagnostics, relation_report, unresolved_ref,
};

/// Resolver output plus the report needed for relation diagnostics.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct StaticIndexRelationModel {
    pub facts: StaticIndexPatchFacts,
    pub report: StaticIndexRelationResolutionReport,
}

/// Returns the canonical graph edge identity for a relation triple.
pub(crate) fn relation_identity(relation_type: &str, from: &str, to: &str) -> String {
    format!("relation:{relation_type}:{from}:{to}")
}

/// Merges relation evidence by semantic identity with fidelity-aware replacement.
pub(crate) fn merge_relations_by_identity(
    relations: impl IntoIterator<Item = StaticIndexRelation>,
) -> Vec<StaticIndexRelation> {
    let mut by_identity = BTreeMap::<String, StaticIndexRelation>::new();
    for mut relation in relations {
        let identity = relation_identity(&relation.r#type, &relation.from, &relation.to);
        let should_replace = by_identity
            .get(&identity)
            .map(|current| relation.fidelity.relation_rank() > current.fidelity.relation_rank())
            .unwrap_or(true);
        if should_replace {
            relation.id = identity.clone();
            by_identity.insert(identity, relation);
        }
    }
    by_identity.into_values().collect()
}

/// Resolves native/extension facts into canonical relations and enriched definitions.
pub(crate) fn resolve_static_index_relation_model(
    mut facts: StaticIndexPatchFacts,
    policies: &StaticIndexRelationPolicyTable,
) -> StaticIndexRelationModel {
    let definitions_by_id = definitions_by_id(&facts.definitions);
    let existing_relations = std::mem::take(&mut facts.relations);
    let mut relations = existing_relations.clone();
    let mut use_entry_targets = Vec::<ResolvedInjectionUseEntryTarget>::new();
    let mut unresolved = Vec::new();
    let mut policy_gaps = BTreeMap::<String, StaticIndexRelationPolicyGap>::new();
    let mut seen_policy_gap_refs = BTreeSet::<String>::new();

    for relation_ref in &facts.relation_refs {
        let fact = fact_ref(relation_ref);
        let Some(_policy) = policies.policy_for(&relation_ref.r#type) else {
            unresolved.push(unresolved_ref("no-policy", fact.clone()));
            record_policy_gap_once(&mut policy_gaps, &mut seen_policy_gap_refs, fact);
            continue;
        };

        let from_id = relation_ref
            .from_id
            .clone()
            .or_else(|| {
                relation_ref
                    .from_variable
                    .as_deref()
                    .and_then(|variable| definition_by_variable(variable, &facts.definitions))
                    .map(|definition| definition.id.clone())
            })
            .unwrap_or_else(|| relation_ref.owner_definition_id.clone());
        let from = definitions_by_id.get(&from_id);
        let target = target_definition(relation_ref, &facts.definitions);
        let to_id = relation_ref
            .to_id
            .clone()
            .or_else(|| target.map(|definition| definition.id.clone()))
            .or_else(|| {
                fallback_relation_target_id(
                    &relation_ref.r#type,
                    relation_ref.to_variable.as_deref(),
                )
            })
            .or_else(|| relation_ref.fallback_to_id.clone());
        let relation_type = target
            .and_then(|definition| relation_ref.type_by_target_kind.get(&definition.kind))
            .map(String::as_str)
            .unwrap_or(&relation_ref.r#type);

        let Some(to_id) = to_id else {
            let reason = if relation_ref.to_variable.is_some() {
                "no-fallback-id"
            } else {
                "no-target"
            };
            unresolved.push(unresolved_ref(reason, fact));
            continue;
        };
        let relation = project_relation(
            relation_type,
            &from_id,
            &to_id,
            relation_fidelity(from, target, relation_ref.to_id.is_some()),
            relation_ref.source.clone(),
        );
        if !relation_ref.extractors.is_empty() {
            facts
                .fact_extractors
                .entry(format!("relations:{}", relation.id))
                .or_default()
                .extend(relation_ref.extractors.clone());
        }
        relations.push(relation);
        if let Some(target) = resolved_use_entry_target(
            relation_ref,
            relation_type,
            &to_id,
            relation_fidelity(from, target, relation_ref.to_id.is_some()),
        ) {
            use_entry_targets.push(target);
        }
    }

    for relation in &existing_relations {
        if policies.policy_for(&relation.r#type).is_none() {
            record_policy_gap_once(
                &mut policy_gaps,
                &mut seen_policy_gap_refs,
                StaticIndexRelationFactRef {
                    owner_definition_id: relation.from.clone(),
                    ref_type: relation.r#type.clone(),
                    to_id: Some(relation.to.clone()),
                    to_variable: None,
                    source: relation.source.clone(),
                },
            );
        }
    }
    let relations = with_agent_thread_relations(merge_relations_by_identity(relations));
    facts.definitions = with_resolved_relation_read_model_with_ref_targets(
        facts.definitions,
        &relations,
        &use_entry_targets,
    );
    facts.relations = relations;
    facts.relation_refs.clear();
    facts
        .diagnostics
        .extend(relation_diagnostics(&unresolved, &policy_gaps));
    facts.canonicalize();

    let report = relation_report(facts.relations.len(), unresolved, policy_gaps);
    StaticIndexRelationModel { facts, report }
}

fn with_agent_thread_relations(relations: Vec<StaticIndexRelation>) -> Vec<StaticIndexRelation> {
    let threads_by_prompt = relations
        .iter()
        .filter(|relation| relation.r#type == "prompt.uses_thread")
        .fold(
            BTreeMap::<String, Vec<&StaticIndexRelation>>::new(),
            |mut map, relation| {
                map.entry(relation.from.clone()).or_default().push(relation);
                map
            },
        );
    let derived = relations
        .iter()
        .filter(|relation| relation.r#type == "agent.uses_prompt")
        .flat_map(|agent_prompt| {
            threads_by_prompt
                .get(&agent_prompt.to)
                .into_iter()
                .flatten()
                .map(move |prompt_thread| StaticIndexRelation {
                    id: relation_identity(
                        "agent.uses_thread",
                        &agent_prompt.from,
                        &prompt_thread.to,
                    ),
                    r#type: "agent.uses_thread".to_string(),
                    from: agent_prompt.from.clone(),
                    to: prompt_thread.to.clone(),
                    fidelity: if agent_prompt.fidelity == StaticIndexFidelity::Resolved
                        && prompt_thread.fidelity == StaticIndexFidelity::Resolved
                    {
                        StaticIndexFidelity::Resolved
                    } else {
                        StaticIndexFidelity::Partial
                    },
                    source: prompt_thread.source.clone(),
                    metadata: Some(serde_json::json!({
                        "viaPromptDefinitionId": agent_prompt.to,
                    })),
                })
        })
        .collect::<Vec<_>>();
    merge_relations_by_identity(relations.into_iter().chain(derived))
}

fn resolved_use_entry_target(
    relation_ref: &StaticIndexRelationRef,
    relation_type: &str,
    to_id: &str,
    fidelity: StaticIndexFidelity,
) -> Option<ResolvedInjectionUseEntryTarget> {
    if !is_injection_use_relation_type(relation_type) {
        return None;
    }
    Some(ResolvedInjectionUseEntryTarget {
        owner_definition_id: relation_ref.owner_definition_id.clone(),
        variable: relation_ref.to_variable.clone()?,
        target_definition_id: to_id.to_string(),
        relation_type: relation_type.to_string(),
        relation_fidelity: fidelity,
    })
}

fn project_relation(
    relation_type: &str,
    from: &str,
    to: &str,
    fidelity: StaticIndexFidelity,
    source: Option<StaticIndexSourceLocation>,
) -> StaticIndexRelation {
    StaticIndexRelation {
        id: relation_identity(relation_type, from, to),
        r#type: relation_type.to_string(),
        from: from.to_string(),
        to: to.to_string(),
        fidelity,
        source,
        metadata: None,
    }
}

fn definitions_by_id(
    definitions: &[StaticIndexDefinition],
) -> BTreeMap<String, &StaticIndexDefinition> {
    definitions
        .iter()
        .map(|definition| (definition.id.clone(), definition))
        .collect()
}

fn target_definition<'a>(
    relation_ref: &StaticIndexRelationRef,
    definitions: &'a [StaticIndexDefinition],
) -> Option<&'a StaticIndexDefinition> {
    if let Some(to_id) = &relation_ref.to_id {
        return definitions
            .iter()
            .find(|definition| definition.id == *to_id);
    }
    None
}

fn definition_by_variable<'a>(
    variable: &str,
    definitions: &'a [StaticIndexDefinition],
) -> Option<&'a StaticIndexDefinition> {
    let safe_variable = safe_use_entry_id(variable);
    definitions.iter().find(|definition| {
        definition.name == variable
            || definition_export_name(definition).as_deref() == Some(variable)
            || definition.id.ends_with(&format!(":{variable}"))
            || definition.id.ends_with(&format!(":{safe_variable}"))
    })
}

fn definition_export_name(definition: &StaticIndexDefinition) -> Option<String> {
    definition
        .metadata
        .as_ref()
        .and_then(|metadata| metadata.get("exportName"))
        .and_then(|value| value.as_str())
        .map(str::to_string)
}

fn relation_fidelity(
    from: Option<&&StaticIndexDefinition>,
    target: Option<&StaticIndexDefinition>,
    explicit_target: bool,
) -> StaticIndexFidelity {
    let from_resolved = from
        .map(|definition| definition.fidelity == StaticIndexFidelity::Resolved)
        .unwrap_or(false);
    let target_resolved = explicit_target
        || target
            .map(|definition| definition.fidelity == StaticIndexFidelity::Resolved)
            .unwrap_or(false);
    if from_resolved && target_resolved {
        StaticIndexFidelity::Resolved
    } else {
        StaticIndexFidelity::Partial
    }
}

pub(crate) fn string_set(values: impl IntoIterator<Item = String>) -> Vec<String> {
    values
        .into_iter()
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect()
}
