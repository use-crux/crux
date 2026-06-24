//! Relation-driven built-in lint rules for native static graph facts.

use std::collections::{BTreeMap, BTreeSet};

use serde_json::Value;

use crate::static_compiler::facts::{
    NativeStaticDefinition, NativeStaticLintFinding, NativeStaticRelation,
};
use crate::static_compiler::lint_builder::{
    NativeStaticLintBuilder, NativeStaticLintFindingInput, definition_evidence, relation_evidence,
    string_array,
};
use crate::static_compiler::lint_contracts::{
    is_state_resource_read_relation, is_state_resource_write_relation,
};
use crate::static_compiler::lint_helpers::has_conflict_policy;

pub(crate) fn relation_lint_findings(
    builder: &NativeStaticLintBuilder,
    relations: &[NativeStaticRelation],
    by_id: &BTreeMap<&str, &NativeStaticDefinition>,
) -> Vec<NativeStaticLintFinding> {
    let mut findings = state_resource_write_without_read_findings(builder, by_id, relations);
    for relation in relations {
        if relation.r#type == "agent.can_handoff_to" {
            append_handoff_finding(builder, by_id, relation, &mut findings);
        }
        if relation.r#type == "swarm.uses_blackboard" {
            append_shared_blackboard_finding(builder, by_id, relation, &mut findings);
        }
    }
    findings
}

fn append_handoff_finding(
    builder: &NativeStaticLintBuilder,
    by_id: &BTreeMap<&str, &NativeStaticDefinition>,
    relation: &NativeStaticRelation,
    findings: &mut Vec<NativeStaticLintFinding>,
) {
    let Some(agent) = by_id.get(relation.from.as_str()) else {
        return;
    };
    let target = by_id.get(relation.to.as_str());
    if agent.kind != "agent" || target.is_some_and(|target| target.kind == "agent") {
        return;
    }
    if let Some(finding) = builder.finding(NativeStaticLintFindingInput {
        rule_id: "agent.unobservable_handoff",
        key: &format!("{}:{}", relation.from, relation.to),
        message: format!(
            "Agent \"{}\" hands off to \"{}\" but that target is not index-visible.",
            agent.name, relation.to
        ),
        source: relation.source.as_ref().or(agent.source.as_ref()),
        primary_definition_id: Some(relation.from.as_str()),
        related_definition_ids: vec![relation.from.clone(), relation.to.clone()],
        evidence: vec![
            definition_evidence(agent, "Agent declares a handoff"),
            relation_evidence(relation, "Handoff target is not index-visible"),
        ],
        fixes: Vec::new(),
    }) {
        findings.push(finding);
    }
}

fn append_shared_blackboard_finding(
    builder: &NativeStaticLintBuilder,
    by_id: &BTreeMap<&str, &NativeStaticDefinition>,
    relation: &NativeStaticRelation,
    findings: &mut Vec<NativeStaticLintFinding>,
) {
    let Some(swarm) = by_id.get(relation.from.as_str()) else {
        return;
    };
    let Some(blackboard) = by_id.get(relation.to.as_str()) else {
        return;
    };
    if has_conflict_policy(blackboard) {
        return;
    }
    if let Some(finding) = builder.finding(NativeStaticLintFindingInput {
        rule_id: "shared_blackboard_without_policy",
        key: &format!("{}:{}", relation.from, relation.to),
        message: format!(
            "Swarm \"{}\" shares blackboard \"{}\" without a visible conflict policy.",
            swarm.name, blackboard.name
        ),
        source: relation
            .source
            .as_ref()
            .or(swarm.source.as_ref())
            .or(blackboard.source.as_ref()),
        primary_definition_id: Some(relation.from.as_str()),
        related_definition_ids: vec![relation.from.clone(), relation.to.clone()],
        evidence: vec![
            definition_evidence(swarm, "Swarm uses shared blackboard"),
            definition_evidence(blackboard, "Blackboard has no visible conflict policy"),
            relation_evidence(relation, "Shared blackboard relation"),
        ],
        fixes: Vec::new(),
    }) {
        findings.push(finding);
    }
}

fn state_resource_write_without_read_findings(
    builder: &NativeStaticLintBuilder,
    by_id: &BTreeMap<&str, &NativeStaticDefinition>,
    relations: &[NativeStaticRelation],
) -> Vec<NativeStaticLintFinding> {
    let mut writes_by_target = BTreeMap::<&str, Vec<&NativeStaticRelation>>::new();
    let mut read_targets = BTreeSet::<&str>::new();
    for relation in relations {
        if is_state_resource_read_relation(relation) {
            read_targets.insert(relation.to.as_str());
            continue;
        }
        if is_state_resource_write_relation(relation) {
            writes_by_target
                .entry(relation.to.as_str())
                .or_default()
                .push(relation);
        }
    }

    let mut findings = Vec::new();
    for (target_id, writes) in writes_by_target {
        if read_targets.contains(target_id) {
            continue;
        }
        let target = by_id.get(target_id).copied();
        let source = target
            .and_then(|definition| definition.source.as_ref())
            .or_else(|| writes.iter().find_map(|relation| relation.source.as_ref()));
        let mut evidence = Vec::new();
        if let Some(target) = target {
            evidence.push(definition_evidence(
                target,
                "State resource receives writes",
            ));
        }
        evidence.extend(
            writes.iter().map(|relation| {
                relation_evidence(relation, "Visible write without a matching read")
            }),
        );
        let Some(mut finding) = builder.finding(NativeStaticLintFindingInput {
            rule_id: "resource.write_without_read",
            key: target_id,
            message: format!(
                "{} receives writes but has no index-visible read path.",
                state_resource_label(target_id, target),
            ),
            source,
            primary_definition_id: Some(target_id),
            related_definition_ids: vec![target_id.to_string()],
            evidence,
            fixes: Vec::new(),
        }) else {
            continue;
        };
        let mut affected = finding
            .extra
            .get("affectedDefinitionIds")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .filter_map(Value::as_str)
            .map(str::to_string)
            .collect::<Vec<_>>();
        affected.extend(writes.iter().map(|relation| relation.from.clone()));
        affected.sort();
        affected.dedup();
        finding.extra.insert(
            "affectedDefinitionIds".to_string(),
            string_array(affected.iter().map(String::as_str)),
        );
        findings.push(finding);
    }
    findings
}

fn state_resource_label(target_id: &str, target: Option<&NativeStaticDefinition>) -> String {
    target
        .map(|definition| format!("{} \"{}\"", definition.kind, definition.name))
        .unwrap_or_else(|| format!("State resource \"{target_id}\""))
}
