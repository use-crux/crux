//! Runtime Engine lint rules backed by Project Index metadata.

use std::collections::BTreeMap;

use serde_json::{Map, Value, json};

use crate::builder::{StaticIndexLintBuilder, StaticIndexLintFindingInput, definition_evidence};
use crate::facts::{StaticIndexDefinition, StaticIndexLintFinding};
use crate::helpers::metadata_value;

pub(crate) fn runtime_lint_findings(
    builder: &StaticIndexLintBuilder,
    definitions: &[StaticIndexDefinition],
    runtime_configured: Option<bool>,
) -> Vec<StaticIndexLintFinding> {
    let targets = runtime_targets(definitions);
    let flows = definitions
        .iter()
        .filter(|definition| definition.kind == "flow")
        .collect::<Vec<_>>();
    let mut findings = Vec::new();
    findings.extend(duplicate_target_name_findings(builder, &targets));
    findings.extend(non_literal_target_name_findings(builder, &targets));
    findings.extend(target_not_exported_findings(builder, &targets));
    findings.extend(missing_runtime_config_findings(
        builder,
        &flows,
        runtime_configured,
    ));
    findings.extend(flow_runtime_usage_findings(builder, &flows));
    findings
}

struct RuntimeTarget<'a> {
    definition: &'a StaticIndexDefinition,
    name_literal: bool,
    exported: bool,
}

fn duplicate_target_name_findings(
    builder: &StaticIndexLintBuilder,
    targets: &[RuntimeTarget<'_>],
) -> Vec<StaticIndexLintFinding> {
    let mut by_name = BTreeMap::<&str, Vec<&RuntimeTarget<'_>>>::new();
    for target in targets {
        by_name
            .entry(target.definition.name.as_str())
            .or_default()
            .push(target);
    }
    by_name
        .into_iter()
        .filter(|(_, items)| items.len() > 1)
        .filter_map(|(name, items)| {
            let primary = items[0].definition;
            builder.finding(StaticIndexLintFindingInput {
                rule_id: "runtime.duplicate_target_name",
                key: name,
                message: format!(
                    "Runtime target name \"{}\" is used by {} flow/task declarations. Durable target names must be unique.",
                    name,
                    items.len()
                ),
                source: primary.source.as_ref(),
                primary_definition_id: Some(primary.id.as_str()),
                related_definition_ids: items
                    .iter()
                    .map(|target| target.definition.id.clone())
                    .collect(),
                evidence: items
                    .iter()
                    .map(|target| {
                        definition_evidence(
                            target.definition,
                            "Runtime target shares this durable name",
                        )
                    })
                    .collect(),
                fixes: Vec::new(),
            })
        })
        .collect()
}

fn non_literal_target_name_findings(
    builder: &StaticIndexLintBuilder,
    targets: &[RuntimeTarget<'_>],
) -> Vec<StaticIndexLintFinding> {
    targets
        .iter()
        .filter(|target| !target.name_literal)
        .filter_map(|target| {
            let definition = target.definition;
            builder.finding(StaticIndexLintFindingInput {
                rule_id: "runtime.non_literal_target_name",
                key: definition.id.as_str(),
                message: format!(
                    "{} \"{}\" does not use a literal durable target name. Use a literal string so Crux can generate stable runtime artifacts.",
                    definition.kind, definition.name
                ),
                source: definition.source.as_ref(),
                primary_definition_id: Some(definition.id.as_str()),
                related_definition_ids: vec![definition.id.clone()],
                evidence: vec![definition_evidence(
                    definition,
                    "Runtime target name is not a literal string",
                )],
                fixes: Vec::new(),
            })
        })
        .collect()
}

fn target_not_exported_findings(
    builder: &StaticIndexLintBuilder,
    targets: &[RuntimeTarget<'_>],
) -> Vec<StaticIndexLintFinding> {
    targets
        .iter()
        .filter(|target| !target.exported)
        .filter_map(|target| {
            let definition = target.definition;
            builder.finding(StaticIndexLintFindingInput {
                rule_id: "runtime.target_not_exported",
                key: definition.id.as_str(),
                message: format!(
                    "{} \"{}\" is not a top-level exported declaration. Generated runtime entries can only import named exports.",
                    definition.kind, definition.name
                ),
                source: definition.source.as_ref(),
                primary_definition_id: Some(definition.id.as_str()),
                related_definition_ids: vec![definition.id.clone()],
                evidence: vec![definition_evidence(definition, "Runtime target is not exported")],
                fixes: Vec::new(),
            })
        })
        .collect()
}

fn flow_runtime_usage_findings(
    builder: &StaticIndexLintBuilder,
    flows: &[&StaticIndexDefinition],
) -> Vec<StaticIndexLintFinding> {
    let mut findings = Vec::new();
    for flow in flows {
        for (index, usage) in runtime_usages(flow)
            .into_iter()
            .filter(|usage| usage.method == "defer" && usage.closure_target)
            .enumerate()
        {
            findings.push(flow_usage_finding(
                builder,
                "runtime.closure_defer",
                &format!("{}:defer:{}", flow.id, index),
                flow,
                format!(
                    "Flow \"{}\" passes an inline closure to flow.defer(). Durable background work must use an exported runtime task target.",
                    flow.name
                ),
                "Flow uses flow.defer with an inline closure target",
                "Inline defer closure",
                &usage,
            ));
        }
        for (index, call) in nondeterministic_calls(flow).into_iter().enumerate() {
            if let Some(finding) = builder.finding(StaticIndexLintFindingInput {
                rule_id: "flow.nondeterministic_code",
                key: &format!("{}:{}:{}", flow.id, call.expression, index),
                message: format!(
                    "Flow \"{}\" calls {} outside flow.step(). Move nondeterministic reads behind a replayed step.",
                    flow.name, call.expression
                ),
                source: flow.source.as_ref(),
                primary_definition_id: Some(flow.id.as_str()),
                related_definition_ids: vec![flow.id.clone()],
                evidence: vec![
                    definition_evidence(flow, "Flow contains nondeterministic code"),
                    json!({
                        "kind": "definition",
                        "label": "Nondeterministic call",
                        "definitionId": flow.id,
                        "source": flow.source,
                        "data": { "expression": call.expression },
                    }),
                ],
                fixes: Vec::new(),
            }) {
                findings.push(finding);
            }
        }
        for (index, usage) in runtime_usages(flow)
            .into_iter()
            .filter(|usage| usage.non_serializable_payload.is_some())
            .enumerate()
        {
            findings.push(flow_usage_finding(
                builder,
                "runtime.non_serializable_payload",
                &format!("{}:{}:payload:{}", flow.id, usage.method, index),
                flow,
                format!(
                    "Flow \"{}\" passes a non-JSON {} payload to flow.{}(). Durable payloads must be JSON-serializable.",
                    flow.name,
                    usage.non_serializable_payload.as_deref().unwrap_or("value"),
                    usage.method
                ),
                "Flow passes a non-JSON durable payload",
                "Non-serializable payload",
                &usage,
            ));
        }
    }
    findings
}

fn missing_runtime_config_findings(
    builder: &StaticIndexLintBuilder,
    flows: &[&StaticIndexDefinition],
    runtime_configured: Option<bool>,
) -> Vec<StaticIndexLintFinding> {
    if runtime_configured != Some(false) {
        return Vec::new();
    }
    flows
        .iter()
        .filter_map(|flow| {
            let usages = runtime_usages(flow);
            if usages.is_empty() {
                return None;
            }
            builder.finding(StaticIndexLintFindingInput {
                rule_id: "runtime.missing_runtime_config",
                key: flow.id.as_str(),
                message: format!(
                    "Flow \"{}\" uses runtime-bound APIs, but this project has no runtime configured.",
                    flow.name
                ),
                source: flow.source.as_ref(),
                primary_definition_id: Some(flow.id.as_str()),
                related_definition_ids: vec![flow.id.clone()],
                evidence: vec![
                    definition_evidence(flow, "Flow uses runtime-bound APIs without runtime config"),
                    json!({
                        "kind": "definition",
                        "label": "Runtime-bound API calls",
                        "definitionId": flow.id,
                        "source": flow.source,
                        "data": { "methods": usages.iter().map(|usage| usage.method.as_str()).collect::<Vec<_>>() },
                    }),
                ],
                fixes: Vec::new(),
            })
        })
        .collect()
}

fn flow_usage_finding(
    builder: &StaticIndexLintBuilder,
    rule_id: &str,
    key: &str,
    flow: &StaticIndexDefinition,
    message: String,
    definition_label: &str,
    usage_label: &str,
    usage: &RuntimeUsage,
) -> StaticIndexLintFinding {
    builder
        .finding(StaticIndexLintFindingInput {
            rule_id,
            key,
            message,
            source: flow.source.as_ref(),
            primary_definition_id: Some(flow.id.as_str()),
            related_definition_ids: vec![flow.id.clone()],
            evidence: vec![
                definition_evidence(flow, definition_label),
                json!({
                    "kind": "definition",
                    "label": usage_label,
                    "definitionId": flow.id,
                    "source": flow.source,
                    "data": runtime_usage_data(usage),
                }),
            ],
            fixes: Vec::new(),
        })
        .expect("runtime lint rule descriptor exists")
}

fn runtime_usage_data(usage: &RuntimeUsage) -> Value {
    let mut data = Map::new();
    data.insert("method".to_string(), Value::String(usage.method.clone()));
    if usage.closure_target {
        data.insert("closureTarget".to_string(), Value::Bool(true));
    }
    if let Some(payload) = &usage.non_serializable_payload {
        data.insert(
            "nonSerializablePayload".to_string(),
            Value::String(payload.clone()),
        );
    }
    Value::Object(data)
}

fn runtime_targets(definitions: &[StaticIndexDefinition]) -> Vec<RuntimeTarget<'_>> {
    definitions
        .iter()
        .filter(|definition| definition.kind == "flow" || definition.kind == "task")
        .filter_map(|definition| {
            let target = metadata_value(definition, "runtimeTarget")?;
            Some(RuntimeTarget {
                definition,
                name_literal: target
                    .get("nameLiteral")
                    .and_then(Value::as_bool)
                    .unwrap_or(false),
                exported: target
                    .get("exported")
                    .and_then(Value::as_bool)
                    .unwrap_or(false),
            })
        })
        .collect()
}

struct RuntimeUsage {
    method: String,
    closure_target: bool,
    non_serializable_payload: Option<String>,
}

fn runtime_usages(definition: &StaticIndexDefinition) -> Vec<RuntimeUsage> {
    metadata_value(definition, "runtimeUsages")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|value| {
            Some(RuntimeUsage {
                method: value.get("method")?.as_str()?.to_string(),
                closure_target: value
                    .get("closureTarget")
                    .and_then(Value::as_bool)
                    .unwrap_or(false),
                non_serializable_payload: value
                    .get("nonSerializablePayload")
                    .and_then(Value::as_str)
                    .map(str::to_string),
            })
        })
        .collect()
}

struct NondeterministicCall {
    expression: String,
}

fn nondeterministic_calls(definition: &StaticIndexDefinition) -> Vec<NondeterministicCall> {
    metadata_value(definition, "nondeterministicCalls")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|value| {
            Some(NondeterministicCall {
                expression: value.get("expression")?.as_str()?.to_string(),
            })
        })
        .collect()
}
