//! Upstream propagation for native built-in lint findings.

use std::collections::{BTreeMap, BTreeSet, VecDeque};

use serde_json::{Value, json};

use crate::native_static_facts::{NativeStaticLintFinding, NativeStaticRelation};
use crate::native_static_lint_helpers::{PROPAGATING_RELATION_TYPES, owned_string_array};

pub(crate) fn propagate_findings(
    findings: Vec<NativeStaticLintFinding>,
    relations: &[NativeStaticRelation],
) -> Vec<NativeStaticLintFinding> {
    let incoming = incoming_propagating_relations(relations);
    findings
        .into_iter()
        .map(|finding| propagate_finding(finding, &incoming))
        .collect()
}

fn propagate_finding(
    mut finding: NativeStaticLintFinding,
    incoming: &BTreeMap<&str, Vec<&NativeStaticRelation>>,
) -> NativeStaticLintFinding {
    let Some(root) = finding_root(&finding) else {
        return finding;
    };
    let mut visited = related_definition_ids(&finding)
        .into_iter()
        .chain([root.clone()])
        .collect::<BTreeSet<_>>();
    let mut queue = VecDeque::from([(root.clone(), Vec::<String>::new())]);
    let mut propagated = BTreeSet::<String>::new();
    let mut paths = Vec::<Value>::new();

    while let Some((definition_id, relation_types)) = queue.pop_front() {
        if visited.len() >= 100 {
            break;
        }
        for relation in incoming.get(definition_id.as_str()).into_iter().flatten() {
            if visited.contains(&relation.from) {
                continue;
            }
            let mut next_relation_types = relation_types.clone();
            next_relation_types.push(relation.r#type.clone());
            visited.insert(relation.from.clone());
            propagated.insert(relation.from.clone());
            paths.push(json!({
                "fromDefinitionId": relation.from,
                "toDefinitionId": root,
                "relationTypes": next_relation_types,
            }));
            queue.push_back((relation.from.clone(), next_relation_types));
        }
    }

    if propagated.is_empty() {
        return finding;
    }
    let mut affected = string_array_field(&finding, "affectedDefinitionIds");
    affected.extend(propagated.iter().cloned());
    affected.sort();
    affected.dedup();
    paths.sort_by(|left, right| {
        left.get("fromDefinitionId")
            .and_then(Value::as_str)
            .cmp(&right.get("fromDefinitionId").and_then(Value::as_str))
    });
    finding.extra.insert(
        "affectedDefinitionIds".to_string(),
        owned_string_array(affected),
    );
    finding.extra.insert(
        "propagatedDefinitionIds".to_string(),
        owned_string_array(propagated.into_iter()),
    );
    finding
        .extra
        .insert("propagationPaths".to_string(), Value::Array(paths));
    finding
}

fn incoming_propagating_relations(
    relations: &[NativeStaticRelation],
) -> BTreeMap<&str, Vec<&NativeStaticRelation>> {
    let mut incoming = BTreeMap::<&str, Vec<&NativeStaticRelation>>::new();
    for relation in relations {
        if PROPAGATING_RELATION_TYPES.contains(&relation.r#type.as_str()) {
            incoming
                .entry(relation.to.as_str())
                .or_default()
                .push(relation);
        }
    }
    incoming
}

fn finding_root(finding: &NativeStaticLintFinding) -> Option<String> {
    finding
        .extra
        .get("primaryDefinitionId")
        .and_then(Value::as_str)
        .map(str::to_string)
        .or_else(|| related_definition_ids(finding).into_iter().next())
}

fn related_definition_ids(finding: &NativeStaticLintFinding) -> Vec<String> {
    string_array_field(finding, "relatedDefinitionIds")
}

fn string_array_field(finding: &NativeStaticLintFinding, key: &str) -> Vec<String> {
    finding
        .extra
        .get(key)
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
        .map(str::to_string)
        .collect()
}
