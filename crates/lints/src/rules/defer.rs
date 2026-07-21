//! Request-scoped deferred-work lint rules backed by normalized Project Index facts.

use serde_json::Value;

use crate::builder::{StaticIndexLintBuilder, StaticIndexLintFindingInput, definition_evidence};
use crate::facts::{StaticIndexDefinition, StaticIndexLintFinding, StaticIndexPatchFacts};
use crate::helpers::metadata_value;

pub(crate) fn defer_lint_findings(
    builder: &StaticIndexLintBuilder,
    facts: &StaticIndexPatchFacts,
    runtime_configured: Option<bool>,
) -> Vec<StaticIndexLintFinding> {
    let mut findings = Vec::new();
    for definition in facts
        .definitions
        .iter()
        .filter(|definition| definition.kind == "deferred-work")
    {
        if is_replay_unsafe(definition, facts) {
            push_finding(
                builder,
                &mut findings,
                "defer.replay_unsafe",
                definition,
                "Public defer() cannot run inside a replayable flow body or step. Use flow.defer() for replay-safe durable work.",
            );
            continue;
        }
        let named = metadata_value(definition, "mode").and_then(Value::as_str) == Some("named");
        if named && metadata_value(definition, "consumed").and_then(Value::as_bool) != Some(true) {
            push_finding(
                builder,
                &mut findings,
                "defer.floating_named_promise",
                definition,
                "Named defer() returns a commit promise that must be awaited, returned, or composed into a consumed promise.",
            );
        }
        if named && runtime_configured == Some(false) {
            push_finding(
                builder,
                &mut findings,
                "runtime.missing_runtime_config",
                definition,
                "Named defer() requires Runtime, but this project is explicitly configured without one.",
            );
        }
    }
    findings
}

fn is_replay_unsafe(definition: &StaticIndexDefinition, facts: &StaticIndexPatchFacts) -> bool {
    facts.relations.iter().any(|relation| {
        relation.r#type == "defer.contained_by"
            && relation.from == definition.id
            && facts.definitions.iter().any(|owner| {
                owner.id == relation.to && matches!(owner.kind.as_str(), "flow" | "flow.step")
            })
    })
}

fn push_finding(
    builder: &StaticIndexLintBuilder,
    findings: &mut Vec<StaticIndexLintFinding>,
    rule_id: &str,
    definition: &StaticIndexDefinition,
    message: &str,
) {
    if let Some(finding) = builder.finding(StaticIndexLintFindingInput {
        rule_id,
        key: definition.id.as_str(),
        message: message.to_string(),
        source: definition.source.as_ref(),
        primary_definition_id: Some(definition.id.as_str()),
        related_definition_ids: vec![definition.id.clone()],
        evidence: vec![definition_evidence(
            definition,
            "Deferred work scheduling site",
        )],
        fixes: Vec::new(),
    }) {
        findings.push(finding);
    }
}
