use serde_json::{Map, Value, json};

use crate::{
    index_compiler::core::facts::NativeStaticIndexPatchFacts,
    index_compiler::finalizer::run::NativeStaticFinalizeOutput,
};

const PROJECT_INDEX_PRODUCER_NAME: &str = "@crux/indexer/project-indexer";
const AST_PHASE: &str = "ast";
const TRANSACTION_ID: &str = "native-static-finalize";
const EPOCH: &str = "1970-01-01T00:00:00.000Z";
const MAX_FACTS_PER_BATCH: usize = 100;

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct NativeStaticFinalizeProject {
    pub root: String,
    pub project_name: Option<String>,
}

#[derive(Debug, Clone, Copy)]
pub(crate) struct NativeStaticFinalizeEventOptions<'a> {
    pub phase: &'a str,
    pub invalidates: Option<&'a Value>,
}

pub(crate) fn project_from_fact_values(values: &[Value]) -> Option<NativeStaticFinalizeProject> {
    values.iter().find_map(project_from_fact_value)
}

pub(crate) fn project_patch_events(
    output: &NativeStaticFinalizeOutput,
    project: &NativeStaticFinalizeProject,
    producer_version: &str,
    options: NativeStaticFinalizeEventOptions<'_>,
) -> Vec<Value> {
    if output.counts.is_empty() {
        return Vec::new();
    }
    let phase = if options.phase.is_empty() {
        AST_PHASE
    } else {
        options.phase
    };
    let facts = fact_envelopes(&output.model.facts, &project.root, producer_version, phase);
    if facts.is_empty() {
        return Vec::new();
    }

    let fact_count = facts.len();
    let mut events = vec![json!({
        "protocolVersion": 2,
        "type": "phase:start",
        "transactionId": TRANSACTION_ID,
        "phase": phase,
        "root": project.root,
        "startedAt": EPOCH,
    })];
    for (sequence, batch) in facts.chunks(MAX_FACTS_PER_BATCH).enumerate() {
        events.push(json!({
            "protocolVersion": 2,
            "type": "fact:batch",
            "transactionId": TRANSACTION_ID,
            "sequence": sequence,
            "facts": batch,
        }));
    }
    let mut patch = json!({
        "schemaVersion": 1,
        "phase": phase,
        "project": project_json(project),
        "startedAt": EPOCH,
        "finishedAt": EPOCH,
        "status": "ok",
    });
    if let Some(invalidates) = options.invalidates {
        patch["invalidates"] = invalidates.clone();
    }

    events.push(json!({
        "protocolVersion": 2,
        "type": "phase:done",
        "transactionId": TRANSACTION_ID,
        "phase": phase,
        "patch": patch,
        "summary": {
            "factCount": fact_count,
            "decision": { "nativeStaticComplete": true },
        },
    }));
    events
}

fn project_from_fact_value(value: &Value) -> Option<NativeStaticFinalizeProject> {
    let root = value
        .get("root")
        .and_then(Value::as_str)
        .or_else(|| {
            value
                .get("project")
                .and_then(|project| project.get("root"))
                .and_then(Value::as_str)
        })?
        .to_string();
    if root.is_empty() {
        return None;
    }
    let project_name = value
        .get("projectName")
        .and_then(Value::as_str)
        .or_else(|| {
            value
                .get("project")
                .and_then(|project| project.get("name"))
                .and_then(Value::as_str)
        })
        .map(str::to_string);
    Some(NativeStaticFinalizeProject { root, project_name })
}

fn project_json(project: &NativeStaticFinalizeProject) -> Value {
    let mut value = Map::new();
    value.insert("root".to_string(), Value::String(project.root.clone()));
    if let Some(name) = &project.project_name {
        value.insert("name".to_string(), Value::String(name.clone()));
    }
    Value::Object(value)
}

fn fact_envelopes(
    facts: &NativeStaticIndexPatchFacts,
    project_root: &str,
    producer_version: &str,
    phase: &str,
) -> Vec<Value> {
    let mut envelopes = Vec::new();
    append_array_facts(
        &mut envelopes,
        "definitions",
        &facts.definitions,
        project_root,
        producer_version,
        phase,
    );
    append_array_facts(
        &mut envelopes,
        "relations",
        &facts.relations,
        project_root,
        producer_version,
        phase,
    );
    append_array_facts(
        &mut envelopes,
        "sourceRefs",
        &facts.source_refs,
        project_root,
        producer_version,
        phase,
    );
    append_array_facts(
        &mut envelopes,
        "diagnostics",
        &facts.diagnostics,
        project_root,
        producer_version,
        phase,
    );
    append_array_facts(
        &mut envelopes,
        "lintFindings",
        &facts.lint_findings,
        project_root,
        producer_version,
        phase,
    );
    append_array_facts(
        &mut envelopes,
        "ruleDescriptors",
        &facts.rule_descriptors,
        project_root,
        producer_version,
        phase,
    );
    append_array_facts(
        &mut envelopes,
        "sources",
        &facts.sources,
        project_root,
        producer_version,
        phase,
    );
    if let Some(source_graph) = &facts.source_graph {
        envelopes.push(fact_envelope(
            "sourceGraph",
            "sourceGraph:0",
            source_graph,
            project_root,
            producer_version,
            phase,
        ));
    }
    envelopes
}

fn append_array_facts<T>(
    events: &mut Vec<Value>,
    kind: &str,
    facts: &[T],
    project_root: &str,
    producer_version: &str,
    phase: &str,
) where
    T: serde::Serialize,
{
    for fact in facts {
        let fact_id = index_patch_fact_id(kind, fact, events.len());
        events.push(fact_envelope(
            kind,
            &fact_id,
            fact,
            project_root,
            producer_version,
            phase,
        ));
    }
}

fn fact_envelope<T>(
    kind: &str,
    fact_id: &str,
    fact: &T,
    project_root: &str,
    producer_version: &str,
    phase: &str,
) -> Value
where
    T: serde::Serialize,
{
    json!({
        "schemaVersion": 1,
        "factId": fact_id,
        "kind": kind,
        "phase": phase,
        "projectRoot": project_root,
        "producer": { "name": PROJECT_INDEX_PRODUCER_NAME, "version": producer_version },
        "fidelity": "inferred",
        "provenance": { "kind": "runtime", "attribute": format!("project-index.{phase}") },
        "fact": fact,
    })
}

fn index_patch_fact_id<T>(kind: &str, fact: &T, index: usize) -> String
where
    T: serde::Serialize,
{
    let value = serde_json::to_value(fact).unwrap_or(Value::Null);
    let stable_id = value
        .get("id")
        .or_else(|| value.get("file"))
        .or_else(|| value.get("name"))
        .or_else(|| value.get("ruleId"))
        .or_else(|| value.get("ruleID"))
        .and_then(Value::as_str);
    stable_id
        .map(|id| format!("{kind}:{id}"))
        .unwrap_or_else(|| format!("{kind}:{index}"))
}
