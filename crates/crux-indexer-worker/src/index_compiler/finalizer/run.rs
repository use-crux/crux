//! Native static finalize adapter.

use serde_json::{Value, json};
use std::collections::BTreeSet;

use crate::index_compiler::core::definition_merge::merge_definitions_by_id;
use crate::index_compiler::core::facts::{
    NativeStaticDefinition, NativeStaticDiagnostic, NativeStaticIndexPatchFacts,
    NativeStaticIndexSourceFile, NativeStaticRelation, NativeStaticRuleDescriptor,
    NativeStaticSourceGraph, NativeStaticSourceRefFact,
};
use crate::index_compiler::finalizer::lint_model::apply_native_static_lint_model;
#[cfg(test)]
use crate::index_compiler::relation::model::built_in_relation_policy_table;
use crate::index_compiler::relation::model::{
    NativeStaticRelationModel, NativeStaticRelationPolicyTable,
    resolve_native_static_relation_model,
};
use crate::index_compiler::source::model::with_native_static_source_model;
use crate::lints::builder::builtin_rule_descriptors;
use crate::lints::filter::NativeStaticLintOptions;

/// Result of native static finalization.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct NativeStaticFinalizeOutput {
    pub model: NativeStaticRelationModel,
    pub events: Vec<Value>,
    pub counts: NativeStaticFinalizeFactCounts,
}

/// Fact counters after relation finalization and read-model projection.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub(crate) struct NativeStaticFinalizeFactCounts {
    pub definitions: usize,
    pub relations: usize,
    pub source_refs: usize,
    pub diagnostics: usize,
    pub lint_findings: usize,
    pub rule_descriptors: usize,
    pub sources: usize,
    pub source_graph: usize,
}

impl NativeStaticFinalizeFactCounts {
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
pub(crate) fn finalize_native_static_values(
    native_facts: &[Value],
    extension_facts: &[Value],
) -> NativeStaticFinalizeOutput {
    let policies = built_in_relation_policy_table();
    finalize_native_static_values_with_policies(native_facts, extension_facts, &policies)
}

/// Finalizes values with an explicit policy table from native/extension manifests.
#[cfg(test)]
pub(crate) fn finalize_native_static_values_with_policies(
    native_facts: &[Value],
    extension_facts: &[Value],
    policies: &NativeStaticRelationPolicyTable,
) -> NativeStaticFinalizeOutput {
    finalize_native_static_values_with_lint_options(
        native_facts,
        extension_facts,
        policies,
        &NativeStaticLintOptions::default(),
    )
}

#[cfg(test)]
pub(crate) fn finalize_native_static_values_with_lint_options(
    native_facts: &[Value],
    extension_facts: &[Value],
    policies: &NativeStaticRelationPolicyTable,
    lint_options: &NativeStaticLintOptions,
) -> NativeStaticFinalizeOutput {
    finalize_native_static_values_with_lint_facts(
        native_facts,
        extension_facts,
        &[],
        policies,
        lint_options,
    )
}

pub(crate) fn finalize_native_static_values_with_lint_facts(
    native_facts: &[Value],
    extension_facts: &[Value],
    lint_facts: &[Value],
    policies: &NativeStaticRelationPolicyTable,
    lint_options: &NativeStaticLintOptions,
) -> NativeStaticFinalizeOutput {
    let mut facts = NativeStaticIndexPatchFacts::default();
    for value in native_facts.iter().chain(extension_facts.iter()) {
        merge_fact_value(&mut facts, value);
    }
    facts.definitions = merge_definitions_by_id(facts.definitions);
    append_missing_builtin_rule_descriptors(&mut facts);
    facts.canonicalize();
    let relation_model = resolve_native_static_relation_model(facts, policies);
    let mut facts = with_native_static_source_model(relation_model.facts);
    apply_native_static_lint_model(&mut facts, lint_facts, policies, lint_options);
    facts.canonicalize();
    let model = NativeStaticRelationModel {
        facts,
        report: relation_model.report,
    };
    let counts = fact_counts(&model.facts);
    let events = fact_events(&model.facts);
    NativeStaticFinalizeOutput {
        model,
        events,
        counts,
    }
}

pub(crate) fn append_missing_builtin_rule_descriptors(facts: &mut NativeStaticIndexPatchFacts) {
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

fn has_materialized_non_descriptor_facts(facts: &NativeStaticIndexPatchFacts) -> bool {
    !facts.definitions.is_empty()
        || !facts.relations.is_empty()
        || !facts.relation_refs.is_empty()
        || !facts.source_refs.is_empty()
        || !facts.diagnostics.is_empty()
        || !facts.lint_findings.is_empty()
        || !facts.sources.is_empty()
        || facts.source_graph.is_some()
}

pub(crate) fn merge_fact_value(facts: &mut NativeStaticIndexPatchFacts, value: &Value) {
    if let Ok(grouped) = serde_json::from_value::<NativeStaticIndexPatchFacts>(value.clone()) {
        merge_grouped_facts(facts, grouped);
        return;
    }

    let kind = value.get("kind").and_then(Value::as_str);
    let payload = value.get("fact").unwrap_or(value);
    match kind {
        Some("definition" | "definitions") => {
            push_parsed::<NativeStaticDefinition, _>(payload, |fact| facts.definitions.push(fact))
        }
        Some("relation" | "relations") => {
            push_parsed::<NativeStaticRelation, _>(payload, |fact| facts.relations.push(fact))
        }
        Some("source-ref" | "sourceRef" | "sourceRefs" | "source_refs") => {
            push_parsed::<NativeStaticSourceRefFact, _>(payload, |fact| {
                facts.source_refs.push(fact)
            })
        }
        Some("diagnostic" | "diagnostics") => {
            push_parsed::<NativeStaticDiagnostic, _>(payload, |fact| facts.diagnostics.push(fact))
        }
        Some("rule-descriptor" | "ruleDescriptor" | "ruleDescriptors" | "rule_descriptors") => {
            push_parsed::<NativeStaticRuleDescriptor, _>(payload, |fact| {
                facts.rule_descriptors.push(fact)
            })
        }
        Some("source" | "sources") => {
            push_parsed::<NativeStaticIndexSourceFile, _>(payload, |fact| facts.sources.push(fact))
        }
        Some("source-graph" | "sourceGraph" | "source_graph") => {
            push_parsed::<NativeStaticSourceGraph, _>(payload, |fact| {
                facts.source_graph = Some(fact)
            })
        }
        _ => {}
    }
}

fn merge_grouped_facts(
    facts: &mut NativeStaticIndexPatchFacts,
    grouped: NativeStaticIndexPatchFacts,
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

fn fact_events(facts: &NativeStaticIndexPatchFacts) -> Vec<Value> {
    let mut envelopes = Vec::new();
    append_array_facts(&mut envelopes, "definitions", &facts.definitions);
    append_array_facts(&mut envelopes, "relations", &facts.relations);
    append_array_facts(&mut envelopes, "sourceRefs", &facts.source_refs);
    append_array_facts(&mut envelopes, "diagnostics", &facts.diagnostics);
    append_array_facts(&mut envelopes, "lintFindings", &facts.lint_findings);
    append_array_facts(&mut envelopes, "ruleDescriptors", &facts.rule_descriptors);
    append_array_facts(&mut envelopes, "sources", &facts.sources);
    if let Some(source_graph) = &facts.source_graph {
        envelopes.push(fact_envelope("sourceGraph", "sourceGraph", source_graph));
    }
    if envelopes.is_empty() {
        return Vec::new();
    }
    vec![json!({
        "protocolVersion": 2,
        "type": "fact:batch",
        "transactionId": "native-static-finalize",
        "sequence": 0,
        "facts": envelopes,
    })]
}

fn fact_counts(facts: &NativeStaticIndexPatchFacts) -> NativeStaticFinalizeFactCounts {
    NativeStaticFinalizeFactCounts {
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

fn append_array_facts<T>(events: &mut Vec<Value>, kind: &str, facts: &[T])
where
    T: serde::Serialize,
{
    for fact in facts {
        let fact_id = serde_json::to_value(fact)
            .ok()
            .and_then(|value| {
                value
                    .get("id")
                    .or_else(|| value.get("definitionId"))
                    .or_else(|| value.get("file"))
                    .and_then(Value::as_str)
                    .map(str::to_string)
            })
            .unwrap_or_else(|| format!("{kind}:{}", events.len()));
        events.push(fact_envelope(kind, &fact_id, fact));
    }
}

fn fact_envelope<T>(kind: &str, fact_id: &str, fact: &T) -> Value
where
    T: serde::Serialize,
{
    json!({
        "schemaVersion": 1,
        "factId": fact_id,
        "kind": kind,
        "phase": "ast",
        "projectRoot": "",
        "producer": { "name": "crux-native-static", "version": "phase-4" },
        "fidelity": "inferred",
        "provenance": { "kind": "runtime", "attribute": "project-index.ast" },
        "fact": fact,
    })
}
