#![allow(dead_code)]

//! Data-only Project Index fact shapes for Static Index finalization.
//!
//! These structs mirror the JSON names owned by `@use-crux/core/project-index`.
//! Metadata-heavy regions stay as `serde_json::Value` until Rust owns those read models.
//! Source locations and snippets are typed because they are stable Project Index
//! contract surfaces emitted by both TypeScript and native frontends.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use serde_json::Value;

/// Static facts that can become an `IndexPatchFacts` payload.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StaticIndexPatchFacts {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub root: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub project_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub project: Option<StaticIndexProjectIdentity>,
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
    pub sources: Vec<StaticIndexSourceRow>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_graph: Option<StaticIndexSourceGraph>,
}

impl StaticIndexPatchFacts {
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

/// Project-level identity and configuration flags used by native finalization.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StaticIndexProjectIdentity {
    pub root: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub config_file: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub runtime_configured: Option<bool>,
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

/// Source span compatible with the Project Index read model.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StaticIndexSourceRange {
    pub file: String,
    pub start_line: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub end_line: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub start_column: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub end_column: Option<usize>,
}

/// Source text excerpt compatible with the Project Index read model.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StaticIndexSourceSnippet {
    pub source: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub language: Option<String>,
    pub range: StaticIndexSourceRange,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub truncated: Option<bool>,
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
    pub source_snippet: Option<StaticIndexSourceSnippet>,
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
    pub snippet: Option<StaticIndexSourceSnippet>,
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
pub struct StaticIndexSourceRow {
    pub file: String,
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub shard_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_hash: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub interface_hash: Option<String>,
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
    pub shards: Option<Vec<StaticIndexSourceGraphShard>>,
}

/// Package/workspace shard row inside the source graph.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StaticIndexSourceGraphShard {
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

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    #[test]
    fn definition_source_snippet_is_a_typed_contract_surface() {
        let snippet = StaticIndexSourceSnippet {
            source: "definePrompt({ name: 'answer' })".to_string(),
            language: Some("typescript".to_string()),
            range: StaticIndexSourceRange {
                file: "src/prompts.ts".to_string(),
                start_line: 3,
                start_column: Some(5),
                end_line: Some(3),
                end_column: Some(37),
            },
            truncated: Some(false),
        };
        let definition = StaticIndexDefinition {
            id: "prompt:answer".to_string(),
            kind: "prompt".to_string(),
            name: "answer".to_string(),
            description: None,
            tags: Vec::new(),
            path: Vec::new(),
            source: None,
            source_snippet: Some(snippet.clone()),
            source_refs: Vec::new(),
            fidelity: StaticIndexFidelity::Resolved,
            status: Some("active".to_string()),
            fingerprint: None,
            metadata: None,
            quality: None,
        };

        let encoded = serde_json::to_value(&definition).expect("encoded definition");

        assert_eq!(encoded["sourceSnippet"]["source"], snippet.source);
        assert_eq!(encoded["sourceSnippet"]["language"], "typescript");
        assert_eq!(encoded["sourceSnippet"]["range"]["startLine"], 3);
        assert_eq!(encoded["sourceSnippet"]["range"]["startColumn"], 5);
    }

    #[test]
    fn source_ref_snippet_deserializes_as_project_index_shape() {
        let facts: StaticIndexPatchFacts = serde_json::from_value(json!({
            "sourceRefs": [{
                "definitionId": "prompt:answer",
                "ref": {
                    "id": "prompt:answer:source:schema:input:inputSchema",
                    "role": "schema",
                    "property": "input",
                    "symbol": "inputSchema",
                    "source": { "file": "src/prompts.ts", "line": 3, "column": 5 },
                    "snippet": {
                        "source": "z.object({ question: z.string() })",
                        "range": { "file": "src/prompts.ts", "startLine": 3 },
                        "truncated": true
                    },
                    "fidelity": "resolved"
                }
            }]
        }))
        .expect("decoded facts");

        let snippet = facts.source_refs[0]
            .ref_
            .snippet
            .as_ref()
            .expect("source-ref snippet");
        assert_eq!(snippet.source, "z.object({ question: z.string() })");
        assert_eq!(snippet.range.file, "src/prompts.ts");
        assert_eq!(snippet.range.start_line, 3);
        assert_eq!(snippet.truncated, Some(true));
    }
}
