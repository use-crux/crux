//! Injection entry and tool-surface lint rules.

use std::collections::{BTreeMap, BTreeSet};

use serde_json::Value;

use crate::static_compiler::core::facts::{NativeStaticDefinition, NativeStaticLintFinding};
use crate::static_compiler::lint::builder::{
    NativeStaticLintBuilder, NativeStaticLintFindingInput,
};
use crate::static_compiler::lint::injection_evidence::{
    contribution_source, entry_evidence, entry_message, injected_source_label, related_ids,
    tool_contribution_evidence, tool_label,
};
use crate::static_compiler::lint::injection_model::NativeStaticInjectionModel;

pub(crate) fn injection_entry_findings(
    builder: &NativeStaticLintBuilder,
    definition: &NativeStaticDefinition,
    model: &NativeStaticInjectionModel,
    by_id: &BTreeMap<&str, &NativeStaticDefinition>,
) -> Vec<NativeStaticLintFinding> {
    let mut findings = Vec::new();
    for entry in &model.unresolved_entries {
        findings.extend(entry_finding(
            builder,
            definition,
            entry,
            by_id,
            "injection.unresolved_target",
            "unresolved",
            "Unresolved injection entry",
            "Definition is affected by an unresolved injection target",
        ));
    }
    for entry in &model.dynamic_entries {
        findings.extend(entry_finding(
            builder,
            definition,
            entry,
            by_id,
            "injection.dynamic_dependency",
            "dynamic",
            "Dynamic injection entry",
            "Definition is affected by dynamic injection",
        ));
    }
    findings.extend(dynamic_tool_findings(builder, definition, model, by_id));
    findings
}

pub(crate) fn indirect_tool_surface_findings(
    builder: &NativeStaticLintBuilder,
    prompt: &NativeStaticDefinition,
    model: &NativeStaticInjectionModel,
    by_id: &BTreeMap<&str, &NativeStaticDefinition>,
) -> Vec<NativeStaticLintFinding> {
    let mut seen = BTreeSet::<String>::new();
    model
        .tool_contributions
        .iter()
        .filter(|contribution| {
            contribution
                .get("sourceDefinitionId")
                .and_then(Value::as_str)
                != Some(prompt.id.as_str())
                && contribution.get("dynamic").and_then(Value::as_bool) != Some(true)
        })
        .filter(|contribution| {
            seen.insert(format!(
                "{}:{}",
                contribution
                    .get("sourceDefinitionId")
                    .and_then(Value::as_str)
                    .unwrap_or("unknown"),
                tool_label(contribution)
            ))
        })
        .filter_map(|contribution| {
            let source = contribution_source(contribution, by_id);
            let label = tool_label(contribution);
            builder.finding(NativeStaticLintFindingInput {
                rule_id: "prompt.indirect_tool_surface",
                key: &format!(
                    "{}:{}:{}",
                    prompt.id,
                    contribution
                        .get("sourceDefinitionId")
                        .and_then(Value::as_str)
                        .unwrap_or("unknown"),
                    label
                ),
                message: format!(
                    "Prompt \"{}\" receives tool surface \"{}\" through injected {}.",
                    prompt.name,
                    label,
                    injected_source_label(source)
                ),
                source: source
                    .and_then(|source| source.source.as_ref())
                    .or(prompt.source.as_ref()),
                primary_definition_id: Some(prompt.id.as_str()),
                related_definition_ids: related_ids(prompt, source),
                evidence: tool_contribution_evidence(
                    prompt,
                    source,
                    contribution,
                    "Prompt receives tools through injection",
                    "Injected tool contributor",
                    "Injected tool contribution",
                ),
                fixes: Vec::new(),
            })
        })
        .collect()
}

fn dynamic_tool_findings(
    builder: &NativeStaticLintBuilder,
    definition: &NativeStaticDefinition,
    model: &NativeStaticInjectionModel,
    by_id: &BTreeMap<&str, &NativeStaticDefinition>,
) -> Vec<NativeStaticLintFinding> {
    let mut seen = BTreeSet::<String>::new();
    model
        .tool_contributions
        .iter()
        .filter(|contribution| contribution.get("dynamic").and_then(Value::as_bool) == Some(true))
        .filter(|contribution| {
            seen.insert(
                contribution
                    .get("sourceDefinitionId")
                    .and_then(Value::as_str)
                    .unwrap_or("unknown")
                    .to_string(),
            )
        })
        .filter_map(|contribution| {
            let source = contribution_source(contribution, by_id);
            builder.finding(NativeStaticLintFindingInput {
                rule_id: "injection.dynamic_tools",
                key: &format!(
                    "{}:{}:{}",
                    definition.id,
                    contribution
                        .get("sourceDefinitionId")
                        .and_then(Value::as_str)
                        .unwrap_or("unknown"),
                    contribution
                        .get("name")
                        .or_else(|| contribution.get("variable"))
                        .and_then(Value::as_str)
                        .unwrap_or("dynamic")
                ),
                message: format!(
                    "{} \"{}\" can receive runtime-dependent tools from {}.",
                    definition.kind,
                    definition.name,
                    injected_source_label(source)
                ),
                source: source
                    .and_then(|source| source.source.as_ref())
                    .or(definition.source.as_ref()),
                primary_definition_id: Some(definition.id.as_str()),
                related_definition_ids: related_ids(definition, source),
                evidence: tool_contribution_evidence(
                    definition,
                    source,
                    contribution,
                    "Definition can receive injected tools",
                    "Injected tool contributor is dynamic",
                    "Dynamic tool contribution",
                ),
                fixes: Vec::new(),
            })
        })
        .collect()
}

fn entry_finding(
    builder: &NativeStaticLintBuilder,
    definition: &NativeStaticDefinition,
    entry: &Value,
    by_id: &BTreeMap<&str, &NativeStaticDefinition>,
    rule_id: &str,
    fallback_key: &str,
    entry_label: &str,
    definition_label: &str,
) -> Option<NativeStaticLintFinding> {
    let owner_id = entry
        .get("ownerDefinitionId")
        .and_then(Value::as_str)
        .unwrap_or(definition.id.as_str());
    let owner = by_id.get(owner_id).copied();
    let variable = entry.get("variable").and_then(Value::as_str);
    builder.finding(NativeStaticLintFindingInput {
        rule_id,
        key: &format!(
            "{}:{}:{}",
            definition.id,
            owner_id,
            variable
                .or_else(|| entry.get("via").and_then(Value::as_str))
                .unwrap_or(fallback_key)
        ),
        message: entry_message(definition, rule_id, variable),
        source: owner
            .and_then(|owner| owner.source.as_ref())
            .or(definition.source.as_ref()),
        primary_definition_id: Some(definition.id.as_str()),
        related_definition_ids: vec![definition.id.clone(), owner_id.to_string()],
        evidence: entry_evidence(definition, owner, entry, definition_label, entry_label),
        fixes: Vec::new(),
    })
}
