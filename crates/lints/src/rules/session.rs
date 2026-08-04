//! Built-in lint rules for durable Agent Session authoring.

use std::collections::BTreeMap;

use serde_json::{Map, Value, json};

use crate::builder::{StaticIndexLintBuilder, StaticIndexLintFindingInput, relation_evidence};
use crate::facts::{StaticIndexDefinition, StaticIndexLintFinding, StaticIndexPatchFacts};

pub(crate) fn session_lint_findings(
    builder: &StaticIndexLintBuilder,
    facts: &StaticIndexPatchFacts,
    by_id: &BTreeMap<&str, &StaticIndexDefinition>,
) -> Vec<StaticIndexLintFinding> {
    let mut findings = unstable_identity_findings(builder, &facts.definitions);
    findings.extend(invalid_target_findings(builder, &facts.definitions));
    findings.extend(ambiguous_construction_findings(builder, &facts.definitions));
    findings.extend(shared_agent_thread_findings(builder, facts, by_id));
    findings
}

fn unstable_identity_findings(
    builder: &StaticIndexLintBuilder,
    definitions: &[StaticIndexDefinition],
) -> Vec<StaticIndexLintFinding> {
    definitions
        .iter()
        .filter_map(|definition| {
            let facts = session_facts(definition)?;
            if facts.get("identity").and_then(Value::as_str) != Some("partial") {
                return None;
            }
            if facts
                .get("key")
                .and_then(Value::as_object)
                .and_then(|key| key.get("kind"))
                .and_then(Value::as_str)
                != Some("dynamic")
            {
                return None;
            }
            builder.finding(StaticIndexLintFindingInput {
                rule_id: "session.unstable_identity",
                key: definition.id.as_str(),
                message: format!(
                    "Session \"{}\" does not have a statically proven durable key identity.",
                    definition.name
                ),
                source: definition.source.as_ref(),
                primary_definition_id: Some(definition.id.as_str()),
                related_definition_ids: vec![definition.id.clone()],
                evidence: vec![session_evidence(
                    definition,
                    facts,
                    "Session identity evidence is partial",
                    &["identity", "key", "operation", "targetDefinitionId"],
                )],
                fixes: Vec::new(),
            })
        })
        .collect()
}

fn invalid_target_findings(
    builder: &StaticIndexLintBuilder,
    definitions: &[StaticIndexDefinition],
) -> Vec<StaticIndexLintFinding> {
    definitions
        .iter()
        .filter_map(|definition| {
            let facts = session_facts(definition)?;
            if facts
                .get("targetDefinitionId")
                .and_then(Value::as_str)
                .is_some()
            {
                return None;
            }
            let target_form = facts
                .get("target")
                .and_then(Value::as_object)
                .and_then(|target| target.get("kind"))
                .and_then(Value::as_str)
                .unwrap_or("unresolved");
            builder.finding(StaticIndexLintFindingInput {
                rule_id: "session.invalid_target",
                key: definition.id.as_str(),
                message: format!(
                    "Session \"{}\" uses an {} Agent target that cannot be generated durably.",
                    definition.name, target_form
                ),
                source: definition.source.as_ref(),
                primary_definition_id: Some(definition.id.as_str()),
                related_definition_ids: vec![definition.id.clone()],
                evidence: vec![session_evidence(
                    definition,
                    facts,
                    "Session Agent target is not statically resolved",
                    &["operation", "target", "targetVariable"],
                )],
                fixes: Vec::new(),
            })
        })
        .collect()
}

fn ambiguous_construction_findings(
    builder: &StaticIndexLintBuilder,
    definitions: &[StaticIndexDefinition],
) -> Vec<StaticIndexLintFinding> {
    definitions
        .iter()
        .filter_map(|definition| {
            let facts = session_facts(definition)?;
            let call = facts.get("call")?.as_object()?;
            if call.get("kind").and_then(Value::as_str) != Some("ambiguous") {
                return None;
            }
            let reason = call
                .get("reason")
                .and_then(Value::as_str)
                .unwrap_or("arguments");
            builder.finding(StaticIndexLintFindingInput {
                rule_id: "session.ambiguous_construction",
                key: definition.id.as_str(),
                message: format!(
                    "Session \"{}\" uses an ambiguous {} call shape.",
                    definition.name, reason
                ),
                source: definition.source.as_ref(),
                primary_definition_id: Some(definition.id.as_str()),
                related_definition_ids: vec![definition.id.clone()],
                evidence: vec![session_evidence(
                    definition,
                    facts,
                    "Session call shape is not canonical",
                    &["call", "operation"],
                )],
                fixes: Vec::new(),
            })
        })
        .collect()
}

fn shared_agent_thread_findings(
    builder: &StaticIndexLintBuilder,
    facts: &StaticIndexPatchFacts,
    by_id: &BTreeMap<&str, &StaticIndexDefinition>,
) -> Vec<StaticIndexLintFinding> {
    let agent_threads = facts
        .relations
        .iter()
        .filter(|relation| relation.r#type == "agent.uses_thread")
        .fold(BTreeMap::<&str, Vec<_>>::new(), |mut grouped, relation| {
            grouped
                .entry(relation.from.as_str())
                .or_default()
                .push(relation);
            grouped
        });
    let mut findings = Vec::new();
    for target in facts
        .relations
        .iter()
        .filter(|relation| relation.r#type == "session.targets_agent")
    {
        for tenancy in agent_threads.get(target.to.as_str()).into_iter().flatten() {
            let Some(session) = by_id.get(target.from.as_str()).copied() else {
                continue;
            };
            let key = format!("{}:{}", session.id, tenancy.to);
            if let Some(finding) = builder.finding(StaticIndexLintFindingInput {
                rule_id: "session.shared_agent_thread",
                key: key.as_str(),
                message: format!(
                    "Session \"{}\" targets Agent \"{}\", which also binds concrete Thread \"{}\".",
                    session.name, target.to, tenancy.to
                ),
                source: session.source.as_ref().or(target.source.as_ref()),
                primary_definition_id: Some(session.id.as_str()),
                related_definition_ids: vec![
                    session.id.clone(),
                    target.to.clone(),
                    tenancy.to.clone(),
                ],
                evidence: vec![
                    relation_evidence(target, "Session targets this Agent"),
                    relation_evidence(tenancy, "Agent binds this concrete Thread"),
                ],
                fixes: Vec::new(),
            }) {
                findings.push(finding);
            }
        }
    }
    findings
}

fn session_facts(definition: &StaticIndexDefinition) -> Option<&Map<String, Value>> {
    if definition.kind != "session" {
        return None;
    }
    definition
        .metadata
        .as_ref()?
        .get("facts")?
        .as_object()
        .filter(|facts| facts.get("kind").and_then(Value::as_str) == Some("session"))
}

fn session_evidence(
    definition: &StaticIndexDefinition,
    facts: &Map<String, Value>,
    label: &str,
    fields: &[&str],
) -> Value {
    let data = fields
        .iter()
        .filter_map(|field| {
            facts
                .get(*field)
                .cloned()
                .map(|value| ((*field).to_string(), value))
        })
        .collect::<Map<_, _>>();
    json!({
        "kind": "definition",
        "label": label,
        "definitionId": definition.id,
        "source": definition.source,
        "data": data,
    })
}
