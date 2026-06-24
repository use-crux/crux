//! Definition rules that depend on state, composition, or routing metadata.

use std::collections::{BTreeMap, BTreeSet};

use serde_json::{Map, Value, json};

use crate::static_compiler::core::facts::{
    NativeStaticDefinition, NativeStaticLintFinding, NativeStaticRelation,
};
use crate::static_compiler::lint::builder::{
    NativeStaticLintBuilder, NativeStaticLintFindingInput, definition_evidence,
};
use crate::static_compiler::lint::emit::push_definition_finding;
use crate::static_compiler::lint::helpers::{
    has_retention_policy, long_lived_memory_blocks, memory_is_long_lived, metadata_value,
    workspace_allows_writes,
};
use crate::static_compiler::lint::routing::{
    is_routing_child, is_routing_root, routing_child_has_unresolved_target, routing_target_variable,
};

pub(crate) struct DefinitionTailContext<'a> {
    pub(crate) guardrail_targets: &'a BTreeSet<String>,
    pub(crate) consensus_policies: &'a BTreeSet<String>,
    pub(crate) outgoing: &'a [&'a NativeStaticRelation],
    pub(crate) cascade_tiers: &'a BTreeMap<String, Vec<&'a NativeStaticDefinition>>,
}

pub(crate) fn definition_tail_findings(
    builder: &NativeStaticLintBuilder,
    definition: &NativeStaticDefinition,
    context: DefinitionTailContext<'_>,
) -> Vec<NativeStaticLintFinding> {
    let mut findings = Vec::new();
    append_state_findings(builder, definition, &context, &mut findings);
    append_routing_findings(builder, definition, &context, &mut findings);
    findings
}

fn append_state_findings(
    builder: &NativeStaticLintBuilder,
    definition: &NativeStaticDefinition,
    context: &DefinitionTailContext<'_>,
    findings: &mut Vec<NativeStaticLintFinding>,
) {
    if definition.kind == "workspace"
        && workspace_allows_writes(definition)
        && !context.guardrail_targets.contains(&definition.id)
    {
        push_definition_finding(
            builder,
            findings,
            "workspace.write_without_guardrail",
            definition,
            format!(
                "Workspace \"{}\" exposes write-capable access without a guardrail relation.",
                definition.name
            ),
            vec![definition_evidence(
                definition,
                "Writable workspace has no guardrail relation",
            )],
        );
    }
    if definition.kind == "memory"
        && memory_is_long_lived(definition)
        && !has_retention_policy(definition)
    {
        push_definition_finding(
            builder,
            findings,
            "memory.long_lived_without_retention",
            definition,
            format!(
                "Memory \"{}\" has long-lived blocks but no visible retention policy.",
                definition.name
            ),
            vec![
                definition_evidence(definition, "Long-lived memory has no retention policy"),
                json!({
                    "kind": "definition",
                    "label": "Long-lived blocks",
                    "definitionId": definition.id,
                    "source": definition.source,
                    "data": { "blocks": long_lived_memory_blocks(definition) },
                }),
            ],
        );
    }
    if definition.kind == "composition.consensus"
        && !context.consensus_policies.contains(&definition.id)
    {
        push_definition_finding(
            builder,
            findings,
            "consensus.missing_judge",
            definition,
            format!(
                "Consensus \"{}\" has no visible judge or scorer.",
                definition.name
            ),
            vec![definition_evidence(
                definition,
                "Consensus has no visible judge or scorer",
            )],
        );
    }
}

fn append_routing_findings(
    builder: &NativeStaticLintBuilder,
    definition: &NativeStaticDefinition,
    context: &DefinitionTailContext<'_>,
    findings: &mut Vec<NativeStaticLintFinding>,
) {
    if is_routing_root(definition) && metadata_bool(definition, "hasStableId") != Some(true) {
        push_definition_finding(
            builder,
            findings,
            "routing.missing_stable_id",
            definition,
            format!(
                "{} \"{}\" uses an indexer fallback id instead of an authored stable id.",
                definition.kind, definition.name
            ),
            vec![definition_evidence(
                definition,
                "Routing primitive has no authored stable id",
            )],
        );
    }
    if definition.kind == "routing.router"
        && metadata_bool(definition, "hasDefaultRoute") != Some(true)
    {
        let mut data = Map::new();
        if let Some(route_keys) = metadata_value(definition, "routeKeys") {
            data.insert("routeKeys".to_string(), route_keys.clone());
        }
        push_definition_finding(
            builder,
            findings,
            "routing.router_missing_default",
            definition,
            format!(
                "Router \"{}\" does not declare a default route.",
                definition.name
            ),
            vec![
                definition_evidence(definition, "Router route map has no default key"),
                json!({
                    "kind": "definition",
                    "label": "Route keys",
                    "definitionId": definition.id,
                    "source": definition.source,
                    "data": Value::Object(data),
                }),
            ],
        );
    }
    append_routing_child_findings(builder, definition, context, findings);
}

fn append_routing_child_findings(
    builder: &NativeStaticLintBuilder,
    definition: &NativeStaticDefinition,
    context: &DefinitionTailContext<'_>,
    findings: &mut Vec<NativeStaticLintFinding>,
) {
    if is_routing_child(definition)
        && routing_child_has_unresolved_target(definition, context.outgoing)
    {
        let target = routing_target_variable(definition).unwrap_or_default();
        push_definition_finding(
            builder,
            findings,
            "routing.unresolved_target",
            definition,
            format!(
                "{} \"{}\" points at \"{}\" but no index-visible target was resolved.",
                definition.kind, definition.name, target
            ),
            vec![definition_evidence(
                definition,
                "Routing target variable has no resolved target relation",
            )],
        );
    }
    if definition.kind != "routing.cascade" {
        return;
    }
    let Some(unreachable) = context.cascade_tiers.get(&definition.id).and_then(|tiers| {
        tiers
            .iter()
            .rev()
            .skip(1)
            .find(|tier| metadata_bool(tier, "hasEvaluate") != Some(true))
    }) else {
        return;
    };
    if let Some(finding) = builder.finding(NativeStaticLintFindingInput {
        rule_id: "routing.cascade_unreachable_tier",
        key: &format!("{}:{}", definition.id, unreachable.id),
        message: format!(
            "Cascade \"{}\" has non-terminal tier \"{}\" without an evaluator.",
            definition.name, unreachable.name
        ),
        source: unreachable.source.as_ref().or(definition.source.as_ref()),
        primary_definition_id: Some(definition.id.as_str()),
        related_definition_ids: vec![definition.id.clone(), unreachable.id.clone()],
        evidence: vec![
            definition_evidence(definition, "Cascade contains ordered tiers"),
            definition_evidence(unreachable, "Non-terminal tier has no evaluate callback"),
        ],
        fixes: Vec::new(),
    }) {
        findings.push(finding);
    }
}

fn metadata_bool(definition: &NativeStaticDefinition, key: &str) -> Option<bool> {
    metadata_value(definition, key).and_then(Value::as_bool)
}
