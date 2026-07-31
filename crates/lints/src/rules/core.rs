//! Non-injection built-in lint rules for Static Index graph facts.

use std::collections::{BTreeMap, BTreeSet};

use serde_json::{Value, json};

use crate::builder::{StaticIndexLintBuilder, StaticIndexLintFindingInput, definition_evidence};
use crate::contracts::{
    context_requires_input_schema, declared_signal_names, flow_requires_args_schema,
    flow_step_labels, has_args_schema, has_input_schema, has_output_schema, has_suspension_points,
    schema_source_evidence, suspension_point_labels, tool_output_needs_adapter,
};
use crate::emit::push_definition_finding;
use crate::facts::{
    StaticIndexDefinition, StaticIndexLintFinding, StaticIndexPatchFacts, StaticIndexRelation,
};
use crate::helpers::{
    child_definitions_by_parent, covered_definition_ids, relation_sources, relations_by_source,
    should_require_coverage, targets_by_relation,
};
use crate::rules::definition_tail::{DefinitionTailContext, definition_tail_findings};
use crate::rules::evidence::evidence_record_findings;
use crate::rules::relation::relation_lint_findings;
use crate::rules::thread::thread_lint_findings;

pub(crate) fn core_lint_findings(
    builder: &StaticIndexLintBuilder,
    facts: &StaticIndexPatchFacts,
    definition_occurrences: &[StaticIndexDefinition],
    by_id: &BTreeMap<&str, &StaticIndexDefinition>,
) -> Vec<StaticIndexLintFinding> {
    let covered = covered_definition_ids(&facts.relations);
    let guardrail_targets = targets_by_relation(&facts.relations, "guardrail.applies_to");
    let consensus_policies = relation_sources(
        &facts.relations,
        &["consensus.uses_judge", "consensus.uses_scorer"],
    );
    let outgoing = relations_by_source(&facts.relations);
    let cascade_tiers = child_definitions_by_parent(
        &facts.definitions,
        "routing.cascade.tier",
        "cascadeDefinitionId",
    );
    let mut findings = Vec::new();
    findings.extend(thread_lint_findings(
        builder,
        facts,
        definition_occurrences,
        by_id,
    ));
    findings.extend(safety_duplicate_policy_id_findings(
        builder,
        &facts.definitions,
    ));
    findings.extend(effect_duplicate_identity_findings(builder, facts));

    for definition in &facts.definitions {
        append_definition_findings(
            builder,
            definition,
            DefinitionRuleContext {
                covered: &covered,
                guardrail_targets: &guardrail_targets,
                consensus_policies: &consensus_policies,
                by_id,
                outgoing: outgoing
                    .get(definition.id.as_str())
                    .map(Vec::as_slice)
                    .unwrap_or(&[]),
                cascade_tiers: &cascade_tiers,
            },
            &mut findings,
        );
    }

    findings.extend(relation_lint_findings(builder, &facts.relations, by_id));
    findings
}

fn effect_duplicate_identity_findings(
    builder: &StaticIndexLintBuilder,
    facts: &StaticIndexPatchFacts,
) -> Vec<StaticIndexLintFinding> {
    facts
        .definitions
        .iter()
        .filter(|definition| definition.kind == "effect")
        .filter_map(|definition| {
            let effect_facts = definition
                .metadata
                .as_ref()?
                .as_object()?
                .get("facts")?
                .as_object()?;
            let effect_id = effect_facts.get("effectId")?.as_str()?;
            let version_value = effect_facts.get("version")?;
            let version = version_value.as_f64().filter(|value| value.is_finite())?;
            let mut execute_refs = definition
                .source_refs
                .iter()
                .chain(
                    facts
                        .source_refs
                        .iter()
                        .filter(|source_ref| source_ref.definition_id == definition.id)
                        .map(|source_ref| &source_ref.ref_),
                )
                .filter(|source_ref| {
                    source_ref.role == "execute"
                        && source_ref.property.as_deref() == Some("executor")
                })
                .collect::<Vec<_>>();
            execute_refs.sort_by(|left, right| left.id.cmp(&right.id));
            execute_refs.dedup_by(|left, right| left.id == right.id);
            if execute_refs.len() < 2 {
                return None;
            }

            builder.finding(StaticIndexLintFindingInput {
                rule_id: "effect.duplicate_identity",
                key: definition.id.as_str(),
                message: format!(
                    "Effect identity \"{}\" version {} is declared at {} call sites.",
                    effect_id,
                    version,
                    execute_refs.len()
                ),
                source: execute_refs.first().map(|source_ref| &source_ref.source),
                primary_definition_id: Some(definition.id.as_str()),
                related_definition_ids: vec![definition.id.clone()],
                evidence: execute_refs
                    .iter()
                    .map(|source_ref| {
                        json!({
                            "kind": "source",
                            "label": "Effect definition shares this (id, version) identity",
                            "source": source_ref.source,
                            "data": {
                                "definitionId": definition.id,
                                "effectId": effect_id,
                                "version": version,
                                "role": source_ref.role,
                                "property": source_ref.property,
                                "symbol": source_ref.symbol,
                            },
                        })
                    })
                    .collect(),
                fixes: Vec::new(),
            })
        })
        .collect()
}

const SAFETY_POLICY_KINDS: &[&str] = &["constraint", "guardrail", "toolPolicy"];

fn safety_duplicate_policy_id_findings(
    builder: &StaticIndexLintBuilder,
    definitions: &[StaticIndexDefinition],
) -> Vec<StaticIndexLintFinding> {
    let mut by_policy_id = BTreeMap::<String, Vec<&StaticIndexDefinition>>::new();
    for definition in definitions {
        if !SAFETY_POLICY_KINDS.contains(&definition.kind.as_str()) {
            continue;
        }
        by_policy_id
            .entry(safety_policy_id(definition))
            .or_default()
            .push(definition);
    }

    by_policy_id
        .into_iter()
        .filter(|(_, items)| items.len() > 1)
        .filter_map(|(policy_id, items)| {
            let primary = items.first().copied();
            builder.finding(StaticIndexLintFindingInput {
                rule_id: "safety.duplicate_policy_id",
                key: policy_id.as_str(),
                message: format!(
                    "Safety policy id \"{}\" is used by {} policy definitions.",
                    policy_id,
                    items.len()
                ),
                source: primary.and_then(|definition| definition.source.as_ref()),
                primary_definition_id: primary.map(|definition| definition.id.as_str()),
                related_definition_ids: items
                    .iter()
                    .map(|definition| definition.id.clone())
                    .collect(),
                evidence: items
                    .iter()
                    .map(|definition| {
                        definition_evidence(definition, "Safety policy shares this id")
                    })
                    .collect(),
                fixes: Vec::new(),
            })
        })
        .collect()
}

fn safety_policy_id(definition: &StaticIndexDefinition) -> String {
    definition
        .metadata
        .as_ref()
        .and_then(Value::as_object)
        .and_then(|metadata| metadata.get("facts"))
        .and_then(Value::as_object)
        .and_then(|facts| facts.get("policyId"))
        .and_then(Value::as_str)
        .unwrap_or(definition.name.as_str())
        .to_string()
}

struct DefinitionRuleContext<'a> {
    covered: &'a BTreeSet<String>,
    guardrail_targets: &'a BTreeSet<String>,
    consensus_policies: &'a BTreeSet<String>,
    by_id: &'a BTreeMap<&'a str, &'a StaticIndexDefinition>,
    outgoing: &'a [&'a StaticIndexRelation],
    cascade_tiers: &'a BTreeMap<String, Vec<&'a StaticIndexDefinition>>,
}

fn append_definition_findings(
    builder: &StaticIndexLintBuilder,
    definition: &StaticIndexDefinition,
    context: DefinitionRuleContext<'_>,
    findings: &mut Vec<StaticIndexLintFinding>,
) {
    findings.extend(evidence_record_findings(builder, definition));
    if definition.kind == "prompt" && !has_input_schema(definition) {
        push_definition_finding(
            builder,
            findings,
            "prompt.missing_input_schema",
            definition,
            format!(
                "Prompt \"{}\" does not expose an input schema in the index.",
                definition.name
            ),
            vec![
                definition_evidence(definition, "Prompt definition has no input schema"),
                Value::Array(schema_source_evidence(
                    definition,
                    "input",
                    "Unresolved input schema source",
                )),
            ],
        );
    }
    if definition.kind == "prompt" && !has_output_schema(definition) {
        push_definition_finding(
            builder,
            findings,
            "prompt.missing_output_schema",
            definition,
            format!(
                "Prompt \"{}\" does not expose an output schema in the index.",
                definition.name
            ),
            vec![
                definition_evidence(definition, "Prompt definition has no output schema"),
                Value::Array(schema_source_evidence(
                    definition,
                    "output",
                    "Unresolved output schema source",
                )),
            ],
        );
    }
    if definition.kind == "context"
        && context_requires_input_schema(definition)
        && !has_input_schema(definition)
    {
        push_definition_finding(
            builder,
            findings,
            "context.missing_input_schema",
            definition,
            format!(
                "Dynamic context \"{}\" does not expose a resolved input schema in the index.",
                definition.name
            ),
            vec![
                definition_evidence(definition, "Dynamic context has no resolved input schema"),
                Value::Array(schema_source_evidence(
                    definition,
                    "input",
                    "Unresolved input schema source",
                )),
            ],
        );
    }
    if definition.kind == "flow"
        && flow_requires_args_schema(definition)
        && !has_args_schema(definition)
    {
        push_definition_finding(
            builder,
            findings,
            "flow.untyped_args",
            definition,
            format!(
                "Flow \"{}\" declares args that Crux cannot project as a schema.",
                definition.name
            ),
            vec![definition_evidence(
                definition,
                "Flow has args but no projected args schema",
            )],
        );
    }
    if definition.kind == "flow" {
        append_flow_suspend_contract_findings(builder, definition, findings);
    }
    if should_require_coverage(definition) && !context.covered.contains(&definition.id) {
        push_definition_finding(
            builder,
            findings,
            "definition.missing_eval_coverage",
            definition,
            format!(
                "{} \"{}\" is not covered by an Eval relation.",
                definition.kind, definition.name
            ),
            vec![definition_evidence(
                definition,
                "Definition without eval coverage",
            )],
        );
    }
    if definition.kind == "tool" && !has_input_schema(definition) {
        push_definition_finding(
            builder,
            findings,
            "tool.missing_input_schema",
            definition,
            format!(
                "Tool \"{}\" does not expose an input schema in the index.",
                definition.name
            ),
            vec![definition_evidence(
                definition,
                "Tool definition has no input schema",
            )],
        );
    }
    if definition.kind == "tool" && tool_output_needs_adapter(definition) {
        push_definition_finding(
            builder,
            findings,
            "tool.output_not_inspectable",
            definition,
            format!(
                "Tool \"{}\" executes code but does not expose a model-output adapter.",
                definition.name
            ),
            vec![definition_evidence(
                definition,
                "Executable tool has no model-output adapter",
            )],
        );
    }
    if definition.kind == "flow"
        && has_suspension_points(definition)
        && !context.covered.contains(&definition.id)
    {
        push_definition_finding(
            builder,
            findings,
            "flow.suspension_without_coverage",
            definition,
            format!(
                "Flow \"{}\" has suspension points but no eval coverage.",
                definition.name
            ),
            vec![
                definition_evidence(definition, "Flow has suspension points"),
                json!({
                    "kind": "definition",
                    "label": "Suspension points",
                    "definitionId": definition.id,
                    "source": definition.source,
                    "data": { "suspensionPoints": suspension_point_labels(definition) },
                }),
            ],
        );
    }
    findings.extend(definition_tail_findings(
        builder,
        definition,
        DefinitionTailContext {
            guardrail_targets: context.guardrail_targets,
            consensus_policies: context.consensus_policies,
            by_id: context.by_id,
            outgoing: context.outgoing,
            cascade_tiers: context.cascade_tiers,
        },
    ));
}

fn append_flow_suspend_contract_findings(
    builder: &StaticIndexLintBuilder,
    definition: &StaticIndexDefinition,
    findings: &mut Vec<StaticIndexLintFinding>,
) {
    let step_labels = flow_step_labels(definition);
    let mut step_counts = BTreeMap::<String, usize>::new();
    for label in &step_labels {
        *step_counts.entry(label.clone()).or_insert(0) += 1;
    }
    for (label, count) in step_counts.into_iter().filter(|(_, count)| *count > 1) {
        push_flow_suspend_finding(
            builder,
            findings,
            "flow.duplicate_step_label",
            &format!("{}:{}", definition.id, label),
            definition,
            format!(
                "Flow \"{}\" uses step label \"{}\" {} times. Step labels are durable replay identities, so repeated labels can return the wrong cached output.",
                definition.name, label, count
            ),
            vec![
                definition_evidence(definition, "Flow has repeated step labels"),
                json!({
                    "kind": "definition",
                    "label": "Duplicate step label",
                    "definitionId": definition.id,
                    "source": definition.source,
                    "data": { "stepLabel": label, "occurrences": count },
                }),
            ],
        );
    }

    let labels = suspension_point_labels(definition);
    let mut counts = BTreeMap::<String, usize>::new();
    for label in &labels {
        *counts.entry(label.clone()).or_insert(0) += 1;
    }
    for (label, count) in counts.into_iter().filter(|(_, count)| *count > 1) {
        push_flow_suspend_finding(
            builder,
            findings,
            "flow.duplicate_suspend_name",
            &format!("{}:{}", definition.id, label),
            definition,
            format!(
                "Flow \"{}\" suspends on \"{}\" {} times. Suspend names are pending-signal keys, so repeated names can make resume behavior ambiguous.",
                definition.name, label, count
            ),
            vec![
                definition_evidence(definition, "Flow has repeated suspend names"),
                json!({
                    "kind": "definition",
                    "label": "Duplicate suspend name",
                    "definitionId": definition.id,
                    "source": definition.source,
                    "data": { "suspendName": label, "occurrences": count },
                }),
            ],
        );
    }

    let Some(declared) = declared_signal_names(definition) else {
        return;
    };
    let mut reported = BTreeSet::new();
    for label in labels {
        if declared.contains(&label) || !reported.insert(label.clone()) {
            continue;
        }
        push_flow_suspend_finding(
            builder,
            findings,
            "flow.undeclared_suspend_signal",
            &format!("{}:{}", definition.id, label),
            definition,
            format!(
                "Flow \"{}\" suspends on \"{}\", but that signal is not declared in the local signal map.",
                definition.name, label
            ),
            vec![
                definition_evidence(
                    definition,
                    "Flow suspend name is missing from the local signal map",
                ),
                json!({
                    "kind": "definition",
                    "label": "Declared signals",
                    "definitionId": definition.id,
                    "source": definition.source,
                    "data": { "signalNames": declared.iter().cloned().collect::<Vec<_>>() },
                }),
            ],
        );
    }
}

fn push_flow_suspend_finding(
    builder: &StaticIndexLintBuilder,
    findings: &mut Vec<StaticIndexLintFinding>,
    rule_id: &str,
    key: &str,
    definition: &StaticIndexDefinition,
    message: String,
    evidence: Vec<Value>,
) {
    if let Some(finding) = builder.finding(StaticIndexLintFindingInput {
        rule_id,
        key,
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
