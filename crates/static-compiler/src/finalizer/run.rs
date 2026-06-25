//! Static Index finalize adapter.

use serde_json::Value;
use std::collections::BTreeSet;

use crate::core::definition_merge::merge_definitions_by_id;
use crate::core::facts::{
    StaticIndexDefinition, StaticIndexDiagnostic, StaticIndexIndexPatchFacts,
    StaticIndexIndexSourceFile, StaticIndexRelation, StaticIndexRuleDescriptor,
    StaticIndexSourceGraph, StaticIndexSourceRefFact,
};
use crate::finalizer::lint_model::apply_static_index_lint_model;
use crate::lints::builder::builtin_rule_descriptors;
use crate::lints::filter::StaticIndexLintOptions;
#[cfg(test)]
use crate::relation::model::built_in_relation_policy_table;
use crate::relation::model::{
    StaticIndexRelationModel, StaticIndexRelationPolicyTable, resolve_static_index_relation_model,
};
use crate::source::model::with_static_index_source_model;

/// Result of Static Index finalization.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct StaticIndexFinalizeOutput {
    pub model: StaticIndexRelationModel,
    pub counts: StaticIndexFinalizeFactCounts,
}

/// Fact counters after relation finalization and read-model projection.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub(crate) struct StaticIndexFinalizeFactCounts {
    pub definitions: usize,
    pub relations: usize,
    pub source_refs: usize,
    pub diagnostics: usize,
    pub lint_findings: usize,
    pub rule_descriptors: usize,
    pub sources: usize,
    pub source_graph: usize,
}

impl StaticIndexFinalizeFactCounts {
    pub(crate) fn total(self) -> usize {
        self.definitions
            + self.relations
            + self.source_refs
            + self.diagnostics
            + self.lint_findings
            + self.rule_descriptors
            + self.sources
            + self.source_graph
    }

    pub(crate) fn is_empty(self) -> bool {
        self.total() == 0
    }
}

/// Finalizes native and extension fact values into canonical relation output.
#[cfg(test)]
pub(crate) fn finalize_static_index_values(
    native_facts: &[Value],
    extension_facts: &[Value],
) -> StaticIndexFinalizeOutput {
    let policies = built_in_relation_policy_table();
    finalize_static_index_values_with_policies(native_facts, extension_facts, &policies)
}

/// Finalizes values with an explicit policy table from native/extension manifests.
#[cfg(test)]
pub(crate) fn finalize_static_index_values_with_policies(
    native_facts: &[Value],
    extension_facts: &[Value],
    policies: &StaticIndexRelationPolicyTable,
) -> StaticIndexFinalizeOutput {
    finalize_static_index_values_with_lint_options(
        native_facts,
        extension_facts,
        policies,
        &StaticIndexLintOptions::default(),
    )
}

#[cfg(test)]
pub(crate) fn finalize_static_index_values_with_lint_options(
    native_facts: &[Value],
    extension_facts: &[Value],
    policies: &StaticIndexRelationPolicyTable,
    lint_options: &StaticIndexLintOptions,
) -> StaticIndexFinalizeOutput {
    finalize_static_index_values_with_lint_facts(
        native_facts,
        extension_facts,
        &[],
        policies,
        lint_options,
    )
}

pub(crate) fn finalize_static_index_values_with_lint_facts(
    native_facts: &[Value],
    extension_facts: &[Value],
    lint_facts: &[Value],
    policies: &StaticIndexRelationPolicyTable,
    lint_options: &StaticIndexLintOptions,
) -> StaticIndexFinalizeOutput {
    let mut facts = StaticIndexIndexPatchFacts::default();
    for value in native_facts.iter().chain(extension_facts.iter()) {
        merge_fact_value(&mut facts, value);
    }
    facts.definitions = merge_definitions_by_id(facts.definitions);
    append_missing_builtin_rule_descriptors(&mut facts);
    facts.canonicalize();
    let relation_model = resolve_static_index_relation_model(facts, policies);
    let mut facts = with_static_index_source_model(relation_model.facts);
    apply_static_index_lint_model(&mut facts, lint_facts, policies, lint_options);
    facts.canonicalize();
    let model = StaticIndexRelationModel {
        facts,
        report: relation_model.report,
    };
    let counts = fact_counts(&model.facts);
    StaticIndexFinalizeOutput { model, counts }
}

pub(crate) fn append_missing_builtin_rule_descriptors(facts: &mut StaticIndexIndexPatchFacts) {
    if !has_materialized_non_descriptor_facts(facts) {
        return;
    }
    let mut seen = facts
        .rule_descriptors
        .iter()
        .map(|descriptor| descriptor.id.clone())
        .collect::<BTreeSet<_>>();
    for descriptor in builtin_rule_descriptors() {
        if seen.insert(descriptor.id.clone()) {
            facts.rule_descriptors.push(descriptor);
        }
    }
}

fn has_materialized_non_descriptor_facts(facts: &StaticIndexIndexPatchFacts) -> bool {
    !facts.definitions.is_empty()
        || !facts.relations.is_empty()
        || !facts.relation_refs.is_empty()
        || !facts.source_refs.is_empty()
        || !facts.diagnostics.is_empty()
        || !facts.lint_findings.is_empty()
        || !facts.sources.is_empty()
        || facts.source_graph.is_some()
}

pub(crate) fn merge_fact_value(facts: &mut StaticIndexIndexPatchFacts, value: &Value) {
    if let Ok(grouped) = serde_json::from_value::<StaticIndexIndexPatchFacts>(value.clone()) {
        merge_grouped_facts(facts, grouped);
        return;
    }

    let kind = value.get("kind").and_then(Value::as_str);
    let payload = value.get("fact").unwrap_or(value);
    match kind {
        Some("definition" | "definitions") => {
            push_parsed::<StaticIndexDefinition, _>(payload, |fact| facts.definitions.push(fact))
        }
        Some("relation" | "relations") => {
            push_parsed::<StaticIndexRelation, _>(payload, |fact| facts.relations.push(fact))
        }
        Some("source-ref" | "sourceRef" | "sourceRefs" | "source_refs") => {
            push_parsed::<StaticIndexSourceRefFact, _>(payload, |fact| facts.source_refs.push(fact))
        }
        Some("diagnostic" | "diagnostics") => {
            push_parsed::<StaticIndexDiagnostic, _>(payload, |fact| facts.diagnostics.push(fact))
        }
        Some("rule-descriptor" | "ruleDescriptor" | "ruleDescriptors" | "rule_descriptors") => {
            push_parsed::<StaticIndexRuleDescriptor, _>(payload, |fact| {
                facts.rule_descriptors.push(fact)
            })
        }
        Some("source" | "sources") => {
            push_parsed::<StaticIndexIndexSourceFile, _>(payload, |fact| facts.sources.push(fact))
        }
        Some("source-graph" | "sourceGraph" | "source_graph") => {
            push_parsed::<StaticIndexSourceGraph, _>(payload, |fact| {
                facts.source_graph = Some(fact)
            })
        }
        _ => {}
    }
}

fn merge_grouped_facts(
    facts: &mut StaticIndexIndexPatchFacts,
    grouped: StaticIndexIndexPatchFacts,
) {
    facts.definitions.extend(grouped.definitions);
    facts.relation_refs.extend(grouped.relation_refs);
    facts.relations.extend(grouped.relations);
    facts.source_refs.extend(grouped.source_refs);
    facts.diagnostics.extend(grouped.diagnostics);
    facts.lint_findings.extend(grouped.lint_findings);
    facts.rule_descriptors.extend(grouped.rule_descriptors);
    facts.sources.extend(grouped.sources);
    if grouped.source_graph.is_some() {
        facts.source_graph = grouped.source_graph;
    }
}

fn push_parsed<T, F>(value: &Value, push: F)
where
    T: serde::de::DeserializeOwned,
    F: FnOnce(T),
{
    if let Ok(fact) = serde_json::from_value::<T>(value.clone()) {
        push(fact);
    }
}

fn fact_counts(facts: &StaticIndexIndexPatchFacts) -> StaticIndexFinalizeFactCounts {
    StaticIndexFinalizeFactCounts {
        definitions: facts.definitions.len(),
        relations: facts.relations.len(),
        source_refs: facts.source_refs.len(),
        diagnostics: facts.diagnostics.len(),
        lint_findings: facts.lint_findings.len(),
        rule_descriptors: facts.rule_descriptors.len(),
        sources: facts.sources.len(),
        source_graph: if facts.source_graph.is_some() { 1 } else { 0 },
    }
}
