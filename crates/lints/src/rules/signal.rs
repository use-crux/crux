//! Built-in lint rules for Signal provider and transport binding authoring.

use serde_json::{Map, Value};

use crate::{
    builder::{StaticIndexLintBuilder, StaticIndexLintFindingInput, definition_evidence},
    facts::{StaticIndexDefinition, StaticIndexLintFinding, StaticIndexPatchFacts},
};

pub(crate) fn signal_lint_findings(
    builder: &StaticIndexLintBuilder,
    facts: &StaticIndexPatchFacts,
) -> Vec<StaticIndexLintFinding> {
    facts
        .definitions
        .iter()
        .flat_map(|definition| signal_definition_findings(builder, definition))
        .collect()
}

fn signal_definition_findings(
    builder: &StaticIndexLintBuilder,
    definition: &StaticIndexDefinition,
) -> Vec<StaticIndexLintFinding> {
    let facts = definition_facts(definition);
    match definition.kind.as_str() {
        "signal.provider" => unstable_provider(builder, definition, facts),
        "signal.transportBinding" => transport_binding_findings(builder, definition, facts),
        _ => Vec::new(),
    }
}

fn unstable_provider(
    builder: &StaticIndexLintBuilder,
    definition: &StaticIndexDefinition,
    facts: Option<&Map<String, Value>>,
) -> Vec<StaticIndexLintFinding> {
    if facts.and_then(|facts| facts.get("identity")).and_then(Value::as_str) != Some("partial") {
        return Vec::new();
    }
    builder
        .finding(StaticIndexLintFindingInput {
            rule_id: "signal.provider.unstable_identity",
            key: definition.id.as_str(),
            message: "Signal provider identity is not a static non-empty string literal.".to_string(),
            source: definition.source.as_ref(),
            primary_definition_id: Some(definition.id.as_str()),
            related_definition_ids: vec![definition.id.clone()],
            evidence: vec![definition_evidence(
                definition,
                "Authored Signal provider declaration",
            )],
            fixes: Vec::new(),
        })
        .into_iter()
        .collect()
}

fn transport_binding_findings(
    builder: &StaticIndexLintBuilder,
    definition: &StaticIndexDefinition,
    facts: Option<&Map<String, Value>>,
) -> Vec<StaticIndexLintFinding> {
    let mut findings = Vec::new();
    if let Some(live_fields) = facts
        .and_then(|facts| facts.get("liveFields"))
        .and_then(Value::as_array)
        .filter(|fields| !fields.is_empty())
    {
        let names = live_fields
            .iter()
            .filter_map(Value::as_str)
            .collect::<Vec<_>>()
            .join(", ");
        if let Some(finding) = builder.finding(StaticIndexLintFindingInput {
            rule_id: "signal.transportBinding.live_value",
            key: definition.id.as_str(),
            message: format!(
                "Managed transport binding declares live value field(s): {names}."
            ),
            source: definition.source.as_ref(),
            primary_definition_id: Some(definition.id.as_str()),
            related_definition_ids: vec![definition.id.clone()],
            evidence: vec![definition_evidence(
                definition,
                "Authored managed transport binding declaration",
            )],
            fixes: Vec::new(),
        }) {
            findings.push(finding);
        }
    }
    if facts.and_then(|facts| facts.get("identity")).and_then(Value::as_str) == Some("partial") {
        if let Some(finding) = builder.finding(StaticIndexLintFindingInput {
            rule_id: "signal.transportBinding.unstable_identity",
            key: definition.id.as_str(),
            message: "Managed transport binding identity, provider, Signal target, or config reference is not statically proven.".to_string(),
            source: definition.source.as_ref(),
            primary_definition_id: Some(definition.id.as_str()),
            related_definition_ids: vec![definition.id.clone()],
            evidence: vec![definition_evidence(
                definition,
                "Authored managed transport binding declaration",
            )],
            fixes: Vec::new(),
        }) {
            findings.push(finding);
        }
    }
    findings
}

fn definition_facts(definition: &StaticIndexDefinition) -> Option<&Map<String, Value>> {
    definition
        .metadata
        .as_ref()
        .and_then(Value::as_object)
        .and_then(|metadata| metadata.get("facts"))
        .and_then(Value::as_object)
}
