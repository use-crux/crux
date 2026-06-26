//! Non-injection built-in lint rules for Static Index graph facts.

use std::collections::{BTreeMap, BTreeSet};

use serde_json::{Map, Value, json};

use crate::builder::{StaticIndexLintBuilder, definition_evidence};
use crate::contracts::{
    context_requires_input_schema, flow_requires_args_schema, has_args_schema, has_input_schema,
    has_output_schema, has_suspension_points, schema_source_evidence, suspension_point_labels,
    tool_output_needs_adapter,
};
use crate::emit::push_definition_finding;
use crate::facts::{
    StaticIndexDefinition, StaticIndexIndexPatchFacts, StaticIndexLintFinding, StaticIndexRelation,
};
use crate::helpers::{
    child_definitions_by_parent, covered_definition_ids, has_items, relation_sources,
    relations_by_source, should_require_coverage, targets_by_relation,
};
use crate::rules::definition_tail::{DefinitionTailContext, definition_tail_findings};
use crate::rules::relation::relation_lint_findings;

pub(crate) fn core_lint_findings(
    builder: &StaticIndexLintBuilder,
    facts: &StaticIndexIndexPatchFacts,
    by_id: &BTreeMap<&str, &StaticIndexDefinition>,
) -> Vec<StaticIndexLintFinding> {
    let covered = covered_definition_ids(&facts.definitions, &facts.relations);
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

    for definition in &facts.definitions {
        append_definition_findings(
            builder,
            definition,
            DefinitionRuleContext {
                covered: &covered,
                guardrail_targets: &guardrail_targets,
                consensus_policies: &consensus_policies,
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

struct DefinitionRuleContext<'a> {
    covered: &'a BTreeSet<String>,
    guardrail_targets: &'a BTreeSet<String>,
    consensus_policies: &'a BTreeSet<String>,
    outgoing: &'a [&'a StaticIndexRelation],
    cascade_tiers: &'a BTreeMap<String, Vec<&'a StaticIndexDefinition>>,
}

fn append_definition_findings(
    builder: &StaticIndexLintBuilder,
    definition: &StaticIndexDefinition,
    context: DefinitionRuleContext<'_>,
    findings: &mut Vec<StaticIndexLintFinding>,
) {
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
    if should_require_coverage(definition) && !context.covered.contains(&definition.id) {
        push_definition_finding(
            builder,
            findings,
            "definition.missing_eval_coverage",
            definition,
            format!(
                "{} \"{}\" is not covered by an eval relation or index quality join.",
                definition.kind, definition.name
            ),
            vec![definition_evidence(
                definition,
                "Definition without eval coverage",
            )],
        );
    }
    if has_experiment_history_without_baseline(definition) {
        push_definition_finding(
            builder,
            findings,
            "quality.missing_baseline",
            definition,
            format!(
                "{} has experiment history but no promoted baseline.",
                definition.name
            ),
            vec![quality_baseline_evidence(definition)],
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
            outgoing: context.outgoing,
            cascade_tiers: context.cascade_tiers,
        },
    ));
}

fn has_experiment_history_without_baseline(definition: &StaticIndexDefinition) -> bool {
    let Some(quality) = definition.quality.as_ref() else {
        return false;
    };
    has_items(quality.get("experimentIds")) && !has_items(quality.get("baselineIds"))
}

fn quality_baseline_evidence(definition: &StaticIndexDefinition) -> Value {
    let quality = definition.quality.as_ref();
    let mut data = json!({
        "experimentIds": quality.and_then(|value| value.get("experimentIds")).cloned().unwrap_or(Value::Array(Vec::new())),
        "experimentCount": quality.and_then(|value| value.get("experimentCount")).cloned().unwrap_or(Value::Number(0.into())),
    });
    if let Some(pass_rate) = quality.and_then(|value| value.get("passRate")).cloned() {
        data["passRate"] = pass_rate;
    }
    if let Some(last_run_id) = quality.and_then(|value| value.get("lastRunId")).cloned() {
        data["lastRunId"] = last_run_id;
    }
    let mut evidence = Map::new();
    evidence.insert("kind".to_string(), json!("quality"));
    evidence.insert(
        "label".to_string(),
        json!("Experiment history without baseline"),
    );
    evidence.insert(
        "description".to_string(),
        json!("This definition has completed experiment data but no baseline quality record."),
    );
    evidence.insert("definitionId".to_string(), json!(definition.id));
    if let Some(source) = definition.source.as_ref() {
        evidence.insert("source".to_string(), json!(source));
    }
    evidence.insert("data".to_string(), data);
    Value::Object(evidence)
}
