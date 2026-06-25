#![allow(dead_code)]

//! Data-only Project Index fact shapes for Static Index finalization.
//!
//! These structs mirror the JSON names owned by `@crux/core/project-index`.
//! Metadata-heavy regions stay as `serde_json::Value` until Rust owns those read models.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use serde_json::Value;

/// Static facts that can become an `IndexPatchFacts` payload.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StaticIndexIndexPatchFacts {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub root: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub project_name: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub definitions: Vec<StaticIndexDefinition>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub relation_refs: Vec<StaticIndexRelationRef>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub relations: Vec<StaticIndexRelation>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub source_refs: Vec<StaticIndexSourceRefFact>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub diagnostics: Vec<StaticIndexDiagnostic>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub lint_findings: Vec<StaticIndexLintFinding>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub rule_descriptors: Vec<StaticIndexRuleDescriptor>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub sources: Vec<StaticIndexIndexSourceFile>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_graph: Option<StaticIndexSourceGraph>,
}

impl StaticIndexIndexPatchFacts {
    /// Sorts fact collections by stable Project Index identities.
    pub fn canonicalize(&mut self) {
        self.definitions
            .sort_by(|left, right| left.id.cmp(&right.id));
        self.relation_refs.sort_by(|left, right| {
            left.owner_definition_id
                .cmp(&right.owner_definition_id)
                .then(left.r#type.cmp(&right.r#type))
                .then(left.from_id.cmp(&right.from_id))
                .then(left.to_id.cmp(&right.to_id))
        });
        self.relations.sort_by(|left, right| left.id.cmp(&right.id));
        self.source_refs.sort_by(|left, right| {
            left.definition_id
                .cmp(&right.definition_id)
                .then(left.ref_.id.cmp(&right.ref_.id))
        });
        // Diagnostics preserve resolver order because TypeScript emits
        // unresolved-reference rows before aggregate policy-gap rows.
        self.lint_findings
            .sort_by(|left, right| left.id.cmp(&right.id));
        self.rule_descriptors
            .sort_by(|left, right| left.id.cmp(&right.id));
        self.sources
            .sort_by(|left, right| left.file.cmp(&right.file));
        if let Some(source_graph) = &mut self.source_graph {
            source_graph.capabilities.sort();
            if let Some(shards) = &mut source_graph.shards {
                shards.sort_by(|left, right| left.id.cmp(&right.id));
            }
        }
    }
}

/// Fidelity vocabulary shared by definitions and graph edges.
#[derive(Debug, Copy, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum StaticIndexFidelity {
    Resolved,
    Partial,
    Error,
}

impl StaticIndexFidelity {
    /// Rank used when replacing lower-fidelity relation evidence.
    pub fn relation_rank(self) -> u8 {
        match self {
            Self::Resolved => 2,
            Self::Partial => 1,
            Self::Error => 0,
        }
    }
}

/// Source coordinate compatible with the Project Index read model.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StaticIndexSourceLocation {
    pub file: String,
    pub line: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub column: Option<usize>,
    #[serde(rename = "function", skip_serializing_if = "Option::is_none")]
    pub function_name: Option<String>,
}

/// Project definition fact emitted by native or extension extraction.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StaticIndexDefinition {
    pub id: String,
    pub kind: String,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub tags: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub path: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source: Option<StaticIndexSourceLocation>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_snippet: Option<Value>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub source_refs: Vec<StaticIndexProjectSourceRef>,
    pub fidelity: StaticIndexFidelity,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fingerprint: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub metadata: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub quality: Option<Value>,
}

/// Resolver-owned relation reference before it becomes a graph edge.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StaticIndexRelationRef {
    pub owner_definition_id: String,
    #[serde(rename = "type")]
    pub r#type: String,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub type_by_target_kind: BTreeMap<String, String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub from_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub from_variable: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub to_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub to_variable: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fallback_to_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source: Option<StaticIndexSourceLocation>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub metadata: Option<Value>,
}

/// Canonical Project Index relation fact.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StaticIndexRelation {
    pub id: String,
    #[serde(rename = "type")]
    pub r#type: String,
    pub from: String,
    pub to: String,
    pub fidelity: StaticIndexFidelity,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source: Option<StaticIndexSourceLocation>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub metadata: Option<Value>,
}

/// Source-ref fact paired with the owning definition id.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StaticIndexSourceRefFact {
    pub definition_id: String,
    #[serde(rename = "ref")]
    pub ref_: StaticIndexProjectSourceRef,
}

/// Project source reference attached to a definition.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StaticIndexProjectSourceRef {
    pub id: String,
    pub role: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub property: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub symbol: Option<String>,
    pub source: StaticIndexSourceLocation,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub snippet: Option<Value>,
    pub fidelity: StaticIndexFidelity,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub metadata: Option<Value>,
}

/// User-visible diagnostic fact.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StaticIndexDiagnostic {
    pub id: String,
    pub severity: StaticIndexDiagnosticSeverity,
    pub code: String,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source: Option<StaticIndexSourceLocation>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub related_definition_ids: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub suggested_fix: Option<String>,
}

/// Diagnostic and lint severity vocabulary.
#[derive(Debug, Copy, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum StaticIndexDiagnosticSeverity {
    Info,
    Warning,
    Error,
}

/// Lint finding fact with typed identity and JSON-owned descriptor fields.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StaticIndexLintFinding {
    pub id: String,
    pub severity: StaticIndexDiagnosticSeverity,
    pub rule_id: String,
    pub title: String,
    pub message: String,
    #[serde(flatten, default, skip_serializing_if = "BTreeMap::is_empty")]
    pub extra: BTreeMap<String, Value>,
}

/// Descriptor for a lint or graph rule available during static finalization.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StaticIndexRuleDescriptor {
    pub id: String,
    pub source: String,
    pub title: String,
    pub description: String,
    #[serde(flatten, default, skip_serializing_if = "BTreeMap::is_empty")]
    pub extra: BTreeMap<String, Value>,
}

/// Source row in the Project Index source table.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StaticIndexIndexSourceFile {
    pub file: String,
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub shard_id: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub definition_ids: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub dependencies: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub dependents: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub diagnostics: Vec<String>,
}

/// Source graph facts used by incremental planning and invalidation.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StaticIndexSourceGraph {
    pub schema_version: u8,
    pub produced_by: String,
    pub capabilities: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub shards: Option<Vec<StaticIndexProjectIndexShard>>,
}

/// Package/workspace shard row inside the source graph.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StaticIndexProjectIndexShard {
    pub id: String,
    pub root: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub package_file: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub config_file: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub discovered_by: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub references: Vec<String>,
}
