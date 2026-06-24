//! Relation resolver conservation report and diagnostic projection.

use std::collections::BTreeMap;

use serde::Serialize;

use crate::native_static_facts::{
    NativeStaticDiagnostic, NativeStaticDiagnosticSeverity, NativeStaticRelationRef,
    NativeStaticSourceLocation,
};

/// Conservation report for relation references that could not become edges.
#[derive(Debug, Clone, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct NativeStaticRelationResolutionReport {
    pub unresolved: Vec<NativeStaticUnresolvedRelationRef>,
    pub policy_gaps: Vec<NativeStaticRelationPolicyGap>,
    pub counts: NativeStaticRelationResolutionCounts,
}

/// Aggregate resolver counts exposed in diagnostics and tests.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct NativeStaticRelationResolutionCounts {
    pub resolved: usize,
    pub unresolved: usize,
    pub policy_gaps: usize,
}

/// Normalized evidence for one relation ref that did not bind.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct NativeStaticUnresolvedRelationRef {
    pub reason: String,
    pub fact: NativeStaticRelationFactRef,
}

/// Missing-policy group reported by relation type.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct NativeStaticRelationPolicyGap {
    #[serde(rename = "type")]
    pub r#type: String,
    pub sample_fact: NativeStaticRelationFactRef,
    pub count: usize,
}

/// Resolver-owned view of relation-ref evidence.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct NativeStaticRelationFactRef {
    pub owner_definition_id: String,
    pub ref_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub to_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub to_variable: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source: Option<NativeStaticSourceLocation>,
}

pub(crate) fn fact_ref(relation_ref: &NativeStaticRelationRef) -> NativeStaticRelationFactRef {
    NativeStaticRelationFactRef {
        owner_definition_id: relation_ref.owner_definition_id.clone(),
        ref_type: relation_ref.r#type.clone(),
        to_id: relation_ref.to_id.clone(),
        to_variable: relation_ref.to_variable.clone(),
        source: relation_ref.source.clone(),
    }
}

pub(crate) fn unresolved_ref(
    reason: &str,
    fact: NativeStaticRelationFactRef,
) -> NativeStaticUnresolvedRelationRef {
    NativeStaticUnresolvedRelationRef {
        reason: reason.to_string(),
        fact,
    }
}

pub(crate) fn record_policy_gap(
    gaps: &mut BTreeMap<String, NativeStaticRelationPolicyGap>,
    relation_type: &str,
    fact: NativeStaticRelationFactRef,
) {
    gaps.entry(relation_type.to_string())
        .and_modify(|gap| gap.count += 1)
        .or_insert_with(|| NativeStaticRelationPolicyGap {
            r#type: relation_type.to_string(),
            sample_fact: fact,
            count: 1,
        });
}

pub(crate) fn relation_diagnostics(
    unresolved: &[NativeStaticUnresolvedRelationRef],
    policy_gaps: &BTreeMap<String, NativeStaticRelationPolicyGap>,
) -> Vec<NativeStaticDiagnostic> {
    let unresolved = unresolved.iter().map(|entry| NativeStaticDiagnostic {
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
        severity: NativeStaticDiagnosticSeverity::Warning,
        code: "relation.unresolved_reference".to_string(),
        message: format!(
            "Could not resolve {} relation target: {}.",
            entry.fact.ref_type, entry.reason
        ),
        source: entry.fact.source.clone(),
        related_definition_ids: vec![entry.fact.owner_definition_id.clone()],
        suggested_fix: None,
    });
    let gaps = policy_gaps.values().map(|gap| NativeStaticDiagnostic {
        id: format!("relation.policy_gap:{}", gap.r#type),
        severity: NativeStaticDiagnosticSeverity::Warning,
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
    unresolved: Vec<NativeStaticUnresolvedRelationRef>,
    policy_gaps: BTreeMap<String, NativeStaticRelationPolicyGap>,
) -> NativeStaticRelationResolutionReport {
    let policy_gaps = policy_gaps.into_values().collect::<Vec<_>>();
    NativeStaticRelationResolutionReport {
        counts: NativeStaticRelationResolutionCounts {
            resolved,
            unresolved: unresolved.len(),
            policy_gaps: policy_gaps.len(),
        },
        unresolved,
        policy_gaps,
    }
}
