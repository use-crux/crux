//! Small emit helpers shared by native lint rule modules.

use serde_json::Value;

use crate::index_compiler::core::facts::{NativeStaticDefinition, NativeStaticLintFinding};
use crate::lints::builder::{NativeStaticLintBuilder, NativeStaticLintFindingInput};

pub(crate) fn push_definition_finding(
    builder: &NativeStaticLintBuilder,
    findings: &mut Vec<NativeStaticLintFinding>,
    rule_id: &str,
    definition: &NativeStaticDefinition,
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
    if let Some(finding) = builder.finding(NativeStaticLintFindingInput {
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
