//! Relation resolver conservation report and diagnostic projection.

use std::collections::BTreeMap;

use serde::Serialize;

use crate::core::facts::{
    StaticIndexDiagnostic, StaticIndexDiagnosticSeverity, StaticIndexRelationRef,
    StaticIndexSourceLocation,
};

/// Conservation report for relation references that could not become edges.
#[derive(Debug, Clone, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct StaticIndexRelationResolutionReport {
    pub unresolved: Vec<StaticIndexUnresolvedRelationRef>,
    pub policy_gaps: Vec<StaticIndexRelationPolicyGap>,
    pub counts: StaticIndexRelationResolutionCounts,
}

/// Aggregate resolver counts exposed in diagnostics and tests.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct StaticIndexRelationResolutionCounts {
    pub resolved: usize,
    pub unresolved: usize,
    pub policy_gaps: usize,
}

/// Normalized evidence for one relation ref that did not bind.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct StaticIndexUnresolvedRelationRef {
    pub reason: String,
    pub fact: StaticIndexRelationFactRef,
}

/// Missing-policy group reported by relation type.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct StaticIndexRelationPolicyGap {
    #[serde(rename = "type")]
    pub r#type: String,
    pub sample_fact: StaticIndexRelationFactRef,
    pub count: usize,
}

/// Resolver-owned view of relation-ref evidence.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct StaticIndexRelationFactRef {
    pub owner_definition_id: String,
    pub ref_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub to_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub to_variable: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source: Option<StaticIndexSourceLocation>,
}

pub(crate) fn fact_ref(relation_ref: &StaticIndexRelationRef) -> StaticIndexRelationFactRef {
    StaticIndexRelationFactRef {
        owner_definition_id: relation_ref
            .from_id
            .clone()
            .unwrap_or_else(|| relation_ref.owner_definition_id.clone()),
        ref_type: relation_ref.r#type.clone(),
        to_id: relation_ref.to_id.clone(),
        to_variable: relation_ref.to_variable.clone(),
        source: relation_ref.source.clone(),
    }
}

pub(crate) fn unresolved_ref(
    reason: &str,
    fact: StaticIndexRelationFactRef,
) -> StaticIndexUnresolvedRelationRef {
    StaticIndexUnresolvedRelationRef {
        reason: reason.to_string(),
        fact,
    }
}

pub(crate) fn record_policy_gap(
    gaps: &mut BTreeMap<String, StaticIndexRelationPolicyGap>,
    relation_type: &str,
    fact: StaticIndexRelationFactRef,
) {
    gaps.entry(relation_type.to_string())
        .and_modify(|gap| gap.count += 1)
        .or_insert_with(|| StaticIndexRelationPolicyGap {
            r#type: relation_type.to_string(),
            sample_fact: fact,
            count: 1,
        });
}

pub(crate) fn relation_diagnostics(
    unresolved: &[StaticIndexUnresolvedRelationRef],
    policy_gaps: &BTreeMap<String, StaticIndexRelationPolicyGap>,
) -> Vec<StaticIndexDiagnostic> {
    let unresolved = unresolved.iter().map(|entry| StaticIndexDiagnostic {
        id: format!(
            "relation.unresolved_reference:{}:{}:{}",
            entry.fact.owner_definition_id,
            entry.fact.ref_type,
            entry
                .fact
                .to_variable
                .as_deref()
                .or(entry.fact.to_id.as_deref())
                .unwrap_or("unknown")
        ),
        severity: StaticIndexDiagnosticSeverity::Warning,
        code: "relation.unresolved_reference".to_string(),
        message: format!(
            "Could not resolve {} relation target: {}.",
            entry.fact.ref_type, entry.reason
        ),
        source: entry.fact.source.clone(),
        related_definition_ids: vec![entry.fact.owner_definition_id.clone()],
        suggested_fix: None,
    });
    let gaps = policy_gaps.values().map(|gap| StaticIndexDiagnostic {
        id: format!("relation.policy_gap:{}", gap.r#type),
        severity: StaticIndexDiagnosticSeverity::Warning,
        code: "relation.policy_gap".to_string(),
        message: format!(
            "No relation policy matched {} \"{}\" relation reference(s).",
            gap.count, gap.r#type
        ),
        source: gap.sample_fact.source.clone(),
        related_definition_ids: vec![gap.sample_fact.owner_definition_id.clone()],
        suggested_fix: None,
    });
    unresolved.chain(gaps).collect()
}

pub(crate) fn relation_report(
    resolved: usize,
    unresolved: Vec<StaticIndexUnresolvedRelationRef>,
    policy_gaps: BTreeMap<String, StaticIndexRelationPolicyGap>,
) -> StaticIndexRelationResolutionReport {
    let policy_gaps = policy_gaps.into_values().collect::<Vec<_>>();
    StaticIndexRelationResolutionReport {
        counts: StaticIndexRelationResolutionCounts {
            resolved,
            unresolved: unresolved.len(),
            policy_gaps: policy_gaps.len(),
        },
        unresolved,
        policy_gaps,
    }
}
