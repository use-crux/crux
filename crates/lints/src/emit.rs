//! Small emit helpers shared by native lint rule modules.

use serde_json::Value;

use crate::builder::{StaticIndexLintBuilder, StaticIndexLintFindingInput};
use crate::facts::{StaticIndexDefinition, StaticIndexLintFinding};

pub(crate) fn push_definition_finding(
    builder: &StaticIndexLintBuilder,
    findings: &mut Vec<StaticIndexLintFinding>,
    rule_id: &str,
    definition: &StaticIndexDefinition,
    message: String,
    evidence_groups: Vec<Value>,
) {
    let evidence = evidence_groups
        .into_iter()
        .flat_map(|value| match value {
            Value::Array(values) => values,
            value => vec![value],
        })
        .collect::<Vec<_>>();
    if let Some(finding) = builder.finding(StaticIndexLintFindingInput {
        rule_id,
        key: definition.id.as_str(),
        message,
        source: definition.source.as_ref(),
        primary_definition_id: Some(definition.id.as_str()),
        related_definition_ids: vec![definition.id.clone()],
        evidence,
        fixes: Vec::new(),
    }) {
        findings.push(finding);
    }
}
