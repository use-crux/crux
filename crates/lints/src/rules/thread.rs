//! Built-in lint rules for authored Thread identity and bindings.

use std::collections::{BTreeMap, BTreeSet};

use serde_json::{Value, json};

use crate::builder::{
    StaticIndexLintBuilder, StaticIndexLintFindingInput, definition_evidence, relation_evidence,
};
use crate::facts::{
    StaticIndexDefinition, StaticIndexLintFinding, StaticIndexPatchFacts,
    StaticIndexProjectSourceRef, StaticIndexRelation, StaticIndexSourceLocation,
};

pub(crate) fn thread_lint_findings(
    builder: &StaticIndexLintBuilder,
    facts: &StaticIndexPatchFacts,
    definitions: &[StaticIndexDefinition],
    by_id: &BTreeMap<&str, &StaticIndexDefinition>,
) -> Vec<StaticIndexLintFinding> {
    let mut findings = duplicate_active_findings(builder, facts, definitions);
    findings.extend(conflicting_binding_findings(
        builder,
        &facts.relations,
        by_id,
    ));
    findings
}

fn duplicate_active_findings(
    builder: &StaticIndexLintBuilder,
    facts: &StaticIndexPatchFacts,
    definitions: &[StaticIndexDefinition],
) -> Vec<StaticIndexLintFinding> {
    let mut by_thread_id = BTreeMap::<String, Vec<&StaticIndexDefinition>>::new();
    for definition in definitions {
        if definition.kind == "thread" && definition.status.as_deref() == Some("active") {
            by_thread_id
                .entry(definition.id.clone())
                .or_default()
                .push(definition);
        }
    }
    for definition in &facts.definitions {
        if definition.kind == "thread" && definition.status.as_deref() == Some("active") {
            by_thread_id.entry(definition.id.clone()).or_default();
        }
    }

    by_thread_id
        .into_iter()
        .filter_map(|(id, definitions)| {
            let normalized = facts
                .definitions
                .iter()
                .find(|definition| definition.id == id);
            let definition_refs = normalized
                .into_iter()
                .flat_map(|definition| &definition.source_refs)
                .filter(|source_ref| {
                    source_ref.role == "definition"
                        && source_ref.id.starts_with("source-ref:thread-definition:")
                })
                .collect::<Vec<_>>();
            let mut occurrences = BTreeMap::<String, Value>::new();
            for definition in &definitions {
                let Some(key) = definition_occurrence_key(definition) else {
                    continue;
                };
                occurrences.entry(key).or_insert_with(|| {
                    definition_evidence(definition, "Active Thread shares this id")
                });
            }
            for source_ref in &definition_refs {
                occurrences
                    .entry(source_location_key(&source_ref.source))
                    .or_insert_with(|| definition_ref_evidence(&id, source_ref));
            }
            let occurrence_count = occurrences.len();
            if occurrence_count < 2 {
                return None;
            }
            let primary = definitions.first().copied().or(normalized);
            let source = definitions
                .iter()
                .filter_map(|definition| definition.source.as_ref())
                .chain(definition_refs.iter().map(|source_ref| &source_ref.source))
                .min_by_key(|source| source_location_key(source));
            builder.finding(StaticIndexLintFindingInput {
                rule_id: "thread.duplicate_active",
                key: id.as_str(),
                message: format!(
                    "Thread definition \"{}\" is active in {} source locations.",
                    id, occurrence_count
                ),
                source,
                primary_definition_id: primary.map(|definition| definition.id.as_str()),
                related_definition_ids: vec![id.clone()],
                evidence: occurrences.into_values().collect(),
                fixes: Vec::new(),
            })
        })
        .collect()
}

fn definition_occurrence_key(definition: &StaticIndexDefinition) -> Option<String> {
    definition
        .source
        .as_ref()
        .map(source_location_key)
        .or_else(|| {
            definition
                .fingerprint
                .as_ref()
                .map(|fingerprint| format!("fingerprint:{fingerprint}"))
        })
}

fn source_location_key(source: &StaticIndexSourceLocation) -> String {
    format!(
        "source:{}:{}:{}:{}",
        source.file,
        source.line,
        source.column.unwrap_or_default(),
        source.function_name.as_deref().unwrap_or_default(),
    )
}

fn definition_ref_evidence(definition_id: &str, source_ref: &StaticIndexProjectSourceRef) -> Value {
    json!({
        "kind": "definition",
        "label": "Active Thread shares this id",
        "definitionId": definition_id,
        "source": source_ref.source,
        "data": { "kind": "thread", "name": source_ref.symbol },
    })
}

fn conflicting_binding_findings(
    builder: &StaticIndexLintBuilder,
    relations: &[StaticIndexRelation],
    by_id: &BTreeMap<&str, &StaticIndexDefinition>,
) -> Vec<StaticIndexLintFinding> {
    let mut by_owner = BTreeMap::<String, Vec<&StaticIndexRelation>>::new();
    for relation in relations {
        if matches!(
            relation.r#type.as_str(),
            "prompt.uses_thread" | "agent.uses_thread"
        ) {
            by_owner
                .entry(relation.from.clone())
                .or_default()
                .push(relation);
        }
    }

    by_owner
        .into_iter()
        .filter_map(|(owner_id, relations)| {
            let thread_ids = relations
                .iter()
                .map(|relation| relation.to.clone())
                .collect::<BTreeSet<_>>();
            if thread_ids.len() < 2 {
                return None;
            }
            let owner = by_id.get(owner_id.as_str()).copied();
            let source = owner
                .and_then(|definition| definition.source.as_ref())
                .or_else(|| {
                    relations
                        .iter()
                        .find_map(|relation| relation.source.as_ref())
                });
            builder.finding(StaticIndexLintFindingInput {
                rule_id: "thread.conflicting_binding",
                key: owner_id.as_str(),
                message: format!(
                    "Definition \"{}\" resolves {} Thread bindings.",
                    owner_id,
                    thread_ids.len()
                ),
                source,
                primary_definition_id: owner.map(|definition| definition.id.as_str()),
                related_definition_ids: std::iter::once(owner_id.clone())
                    .chain(thread_ids)
                    .collect(),
                evidence: relations
                    .iter()
                    .map(|relation| relation_evidence(relation, "Definition uses this Thread"))
                    .collect(),
                fixes: Vec::new(),
            })
        })
        .collect()
}
