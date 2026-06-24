//! Prompt input-contract injection lint rules.

use std::collections::{BTreeMap, BTreeSet};

use serde_json::Value;

use crate::native_static_facts::{NativeStaticDefinition, NativeStaticLintFinding};
use crate::native_static_lint_builder::{NativeStaticLintBuilder, NativeStaticLintFindingInput};
use crate::native_static_lint_contracts::{
    contract_expanded_input_schema, contract_input_schema, contribution_source_requires_field,
    is_conditional_contribution, schema_conflict_reason, schema_required_fields,
};
use crate::native_static_lint_injection_evidence::{
    condition_evidence, conflict_evidence, contribution_evidence, contribution_source,
    injected_source_label, related_ids, related_ids_pair, source_id_or_index,
};
use crate::native_static_lint_injection_model::NativeStaticInjectionModel;

pub(crate) fn prompt_input_injection_findings(
    builder: &NativeStaticLintBuilder,
    prompt: &NativeStaticDefinition,
    model: &NativeStaticInjectionModel,
    by_id: &BTreeMap<&str, &NativeStaticDefinition>,
) -> Vec<NativeStaticLintFinding> {
    let mut findings = Vec::new();
    findings.extend(hidden_required_input_findings(
        builder, prompt, model, by_id,
    ));
    findings.extend(conflicting_injected_input_findings(
        builder, prompt, model, by_id,
    ));
    findings.extend(conditional_required_input_findings(
        builder, prompt, model, by_id,
    ));
    findings.extend(deep_schema_chain_findings(builder, prompt, model, by_id));
    findings
}

fn hidden_required_input_findings(
    builder: &NativeStaticLintBuilder,
    prompt: &NativeStaticDefinition,
    model: &NativeStaticInjectionModel,
    by_id: &BTreeMap<&str, &NativeStaticDefinition>,
) -> Vec<NativeStaticLintFinding> {
    let authored = schema_required_fields(contract_input_schema(prompt));
    let expanded = schema_required_fields(contract_expanded_input_schema(prompt));
    model
        .input_contributions
        .iter()
        .filter(|contribution| contribution.get("required").and_then(Value::as_bool) == Some(true))
        .filter(|contribution| {
            contribution
                .get("field")
                .and_then(Value::as_str)
                .is_some_and(|field| expanded.contains(field) && !authored.contains(field))
        })
        .filter_map(|contribution| {
            let source = contribution_source(contribution, by_id);
            builder.finding(NativeStaticLintFindingInput {
                rule_id: "prompt.hidden_required_input",
                key: &format!(
                    "{}:{}:{}",
                    prompt.id,
                    contribution
                        .get("field")
                        .and_then(Value::as_str)
                        .unwrap_or("unknown"),
                    contribution
                        .get("sourceDefinitionId")
                        .and_then(Value::as_str)
                        .unwrap_or("unknown")
                ),
                message: format!(
                    "Prompt \"{}\" effectively requires \"{}\" through injected {}.",
                    prompt.name,
                    contribution
                        .get("field")
                        .and_then(Value::as_str)
                        .unwrap_or("input"),
                    injected_source_label(source)
                ),
                source: source
                    .and_then(|source| source.source.as_ref())
                    .or(prompt.source.as_ref()),
                primary_definition_id: Some(prompt.id.as_str()),
                related_definition_ids: related_ids(prompt, source),
                evidence: contribution_evidence(
                    prompt,
                    source,
                    contribution,
                    "Prompt input schema does not author this required field",
                    "Injected source contributes the required field",
                    "Injected required input contribution",
                ),
                fixes: Vec::new(),
            })
        })
        .collect()
}

fn conflicting_injected_input_findings(
    builder: &NativeStaticLintBuilder,
    prompt: &NativeStaticDefinition,
    model: &NativeStaticInjectionModel,
    by_id: &BTreeMap<&str, &NativeStaticDefinition>,
) -> Vec<NativeStaticLintFinding> {
    let mut by_field = BTreeMap::<&str, Vec<&Value>>::new();
    for contribution in &model.input_contributions {
        if let Some(field) = contribution.get("field").and_then(Value::as_str) {
            by_field.entry(field).or_default().push(contribution);
        }
    }
    let mut findings = Vec::new();
    for (field, contributions) in by_field {
        for index in 0..contributions.len() {
            for next in (index + 1)..contributions.len() {
                let left = contributions[index];
                let right = contributions[next];
                let Some(reason) = left
                    .get("schema")
                    .zip(right.get("schema"))
                    .and_then(|(left, right)| schema_conflict_reason(left, right))
                else {
                    continue;
                };
                let left_source = contribution_source(left, by_id);
                let right_source = contribution_source(right, by_id);
                if let Some(finding) = builder.finding(NativeStaticLintFindingInput {
                    rule_id: "prompt.conflicting_injected_input",
                    key: &format!(
                        "{}:{}:{}:{}",
                        prompt.id,
                        field,
                        source_id_or_index(left, index),
                        source_id_or_index(right, next)
                    ),
                    message: format!(
                        "Prompt \"{}\" receives incompatible injected schemas for input \"{}\" ({}).",
                        prompt.name, field, reason
                    ),
                    source: left_source
                        .and_then(|source| source.source.as_ref())
                        .or_else(|| right_source.and_then(|source| source.source.as_ref()))
                        .or(prompt.source.as_ref()),
                    primary_definition_id: Some(prompt.id.as_str()),
                    related_definition_ids: related_ids_pair(prompt, left_source, right_source),
                    evidence: conflict_evidence(prompt, left, right, left_source, right_source),
                    fixes: Vec::new(),
                }) {
                    findings.push(finding);
                }
            }
        }
    }
    findings
}

fn conditional_required_input_findings(
    builder: &NativeStaticLintBuilder,
    prompt: &NativeStaticDefinition,
    model: &NativeStaticInjectionModel,
    by_id: &BTreeMap<&str, &NativeStaticDefinition>,
) -> Vec<NativeStaticLintFinding> {
    model
        .input_contributions
        .iter()
        .filter(|contribution| is_conditional_contribution(contribution))
        .filter(|contribution| contribution_source_requires_field(contribution, by_id))
        .filter_map(|contribution| {
            let source = contribution_source(contribution, by_id);
            let field = contribution
                .get("field")
                .and_then(Value::as_str)
                .unwrap_or("input");
            builder.finding(NativeStaticLintFindingInput {
                rule_id: "prompt.conditional_required_input",
                key: &format!(
                    "{}:{}:{}:{}",
                    prompt.id,
                    field,
                    contribution
                        .get("sourceDefinitionId")
                        .and_then(Value::as_str)
                        .unwrap_or("unknown"),
                    contribution
                        .get("conditionality")
                        .and_then(Value::as_str)
                        .unwrap_or("conditional")
                ),
                message: format!(
                    "Prompt \"{}\" has branch-specific required input \"{}\" from {}.",
                    prompt.name,
                    field,
                    source
                        .map(|source| format!("{} \"{}\"", source.kind, source.name))
                        .unwrap_or_else(|| "an injected source".to_string())
                ),
                source: source
                    .and_then(|source| source.source.as_ref())
                    .or(prompt.source.as_ref()),
                primary_definition_id: Some(prompt.id.as_str()),
                related_definition_ids: related_ids(prompt, source),
                evidence: condition_evidence(prompt, source, contribution),
                fixes: Vec::new(),
            })
        })
        .collect()
}

fn deep_schema_chain_findings(
    builder: &NativeStaticLintBuilder,
    prompt: &NativeStaticDefinition,
    model: &NativeStaticInjectionModel,
    by_id: &BTreeMap<&str, &NativeStaticDefinition>,
) -> Vec<NativeStaticLintFinding> {
    let mut seen = BTreeSet::<String>::new();
    model
        .input_contributions
        .iter()
        .filter(|contribution| {
            contribution
                .get("path")
                .and_then(Value::as_array)
                .is_some_and(|path| path.len() > 2)
        })
        .filter(|contribution| seen.insert(deep_schema_chain_key(contribution)))
        .filter_map(|contribution| {
            let source = contribution_source(contribution, by_id);
            let field = contribution
                .get("field")
                .and_then(Value::as_str)
                .unwrap_or("input");
            builder.finding(NativeStaticLintFindingInput {
                rule_id: "injection.deep_schema_chain",
                key: &format!(
                    "{}:{}:{}",
                    prompt.id,
                    field,
                    path_key(contribution).unwrap_or_else(|| "deep".to_string())
                ),
                message: format!(
                    "Prompt \"{}\" receives input \"{}\" through a deep injection chain.",
                    prompt.name, field
                ),
                source: source
                    .and_then(|source| source.source.as_ref())
                    .or(prompt.source.as_ref()),
                primary_definition_id: Some(prompt.id.as_str()),
                related_definition_ids: related_ids(prompt, source),
                evidence: contribution_evidence(
                    prompt,
                    source,
                    contribution,
                    "Prompt receives input through a deep injection chain",
                    "Deep schema contributor",
                    "Deep injected input contribution",
                ),
                fixes: Vec::new(),
            })
        })
        .collect()
}

fn deep_schema_chain_key(contribution: &Value) -> String {
    format!(
        "{}:{}:{}",
        contribution
            .get("field")
            .and_then(Value::as_str)
            .unwrap_or("unknown"),
        contribution
            .get("sourceDefinitionId")
            .and_then(Value::as_str)
            .unwrap_or("unknown"),
        path_key(contribution).unwrap_or_default()
    )
}

fn path_key(contribution: &Value) -> Option<String> {
    contribution
        .get("path")
        .and_then(Value::as_array)
        .map(|path| {
            path.iter()
                .filter_map(Value::as_str)
                .collect::<Vec<_>>()
                .join(">")
        })
        .or_else(|| {
            contribution
                .get("sourceDefinitionId")
                .and_then(Value::as_str)
                .map(str::to_string)
        })
}
