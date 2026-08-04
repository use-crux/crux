use serde_json::json;

use crate::finalizer::events::{
    StaticIndexFinalizeEventOptions, StaticIndexFinalizeProject, project_patch_events,
};
use crate::finalizer::run::finalize_static_index_values_with_policies;
use crate::relation::model::built_in_relation_policy_table;

#[test]
fn project_patch_events_chunks_fact_batches() {
    let definitions = (0..205)
        .map(|index| {
            json!({
                "id": format!("context:item-{index}"),
                "kind": "context",
                "name": format!("item-{index}"),
                "fidelity": "resolved",
                "status": "active",
                "metadata": { "inputSchema": { "type": "object" } }
            })
        })
        .collect::<Vec<_>>();
    let policies = built_in_relation_policy_table();
    let output = finalize_static_index_values_with_policies(
        &[json!({ "definitions": definitions })],
        &[],
        &policies,
    );
    let events = project_patch_events(
        &output,
        &StaticIndexFinalizeProject {
            root: "/repo".to_string(),
            project_name: None,
        },
        "test",
        StaticIndexFinalizeEventOptions {
            phase: "ast",
            invalidates: Some(&json!({ "all": true })),
        },
    );

    let batches = events
        .iter()
        .filter(|event| event["type"] == "fact:batch")
        .collect::<Vec<_>>();
    assert_eq!(batches.len(), 3);
    assert_eq!(batches[0]["sequence"], 0);
    assert_eq!(batches[1]["sequence"], 1);
    assert_eq!(batches[2]["sequence"], 2);
    assert_eq!(
        batches[0]["facts"].as_array().expect("batch facts").len(),
        100
    );
    assert_eq!(
        batches[1]["facts"].as_array().expect("batch facts").len(),
        100
    );
    assert_eq!(
        batches[2]["facts"].as_array().expect("batch facts").len(),
        73
    );
    assert_eq!(
        events.last().expect("phase done")["summary"]["factCount"],
        273
    );
    assert_eq!(
        events.last().expect("phase done")["summary"]["decision"]["staticIndexComplete"],
        true
    );
}

#[test]
fn project_patch_events_can_materialize_quality_phase_without_invalidation() {
    let policies = built_in_relation_policy_table();
    let output = finalize_static_index_values_with_policies(
        &[json!({
            "definitions": [{
                "id": "eval:writer",
                "kind": "eval",
                "name": "writer",
                "fidelity": "resolved"
            }]
        })],
        &[],
        &policies,
    );
    let events = project_patch_events(
        &output,
        &StaticIndexFinalizeProject {
            root: "/repo".to_string(),
            project_name: Some("fixture".to_string()),
        },
        "test",
        StaticIndexFinalizeEventOptions {
            phase: "quality",
            invalidates: None,
        },
    );

    assert_eq!(events.first().expect("phase start")["phase"], "quality");
    assert_eq!(events.last().expect("phase done")["phase"], "quality");
    assert_eq!(
        events.last().expect("phase done")["patch"]["phase"],
        "quality"
    );
    assert!(
        events.last().expect("phase done")["patch"]
            .get("invalidates")
            .is_none()
    );
    let batch = events
        .iter()
        .find(|event| event["type"] == "fact:batch")
        .expect("fact batch");
    assert_eq!(batch["facts"][0]["phase"], "quality");
    assert_eq!(
        batch["facts"][0]["provenance"]["attribute"],
        "project-index.quality"
    );
}

#[test]
fn project_patch_events_attach_canonical_definition_extractors() {
    let policies = built_in_relation_policy_table();
    let output = finalize_static_index_values_with_policies(
        &[json!({
            "definitions": [{
                "id": "prompt:writer",
                "kind": "prompt",
                "name": "writer",
                "fidelity": "resolved"
            }],
            "definitionExtractors": {
                "prompt:writer": [
                    { "name": "zeta", "extension": { "name": "pkg", "version": "2.0.0" } },
                    { "name": "alpha" },
                    { "name": "zeta", "extension": { "name": "pkg", "version": "2.0.0" } }
                ]
            }
        })],
        &[],
        &policies,
    );
    let events = project_patch_events(
        &output,
        &StaticIndexFinalizeProject {
            root: "/repo".to_string(),
            project_name: None,
        },
        "test",
        StaticIndexFinalizeEventOptions {
            phase: "ast",
            invalidates: None,
        },
    );
    let definition = events
        .iter()
        .find(|event| event["type"] == "fact:batch")
        .expect("fact batch")["facts"]
        .as_array()
        .expect("batch facts")
        .iter()
        .find(|fact| fact["kind"] == "definitions")
        .expect("definition envelope");

    assert_eq!(
        definition["provenance"]["extractors"],
        json!([
            { "name": "alpha" },
            { "name": "zeta", "extension": { "name": "pkg", "version": "2.0.0" } }
        ])
    );
    assert_eq!(
        definition["producer"]["name"],
        "@use-crux/indexer/project-indexer"
    );
}

#[test]
fn project_patch_events_preserve_exact_extractors_for_every_emitted_fact_kind() {
    let contributor = json!({
        "name": "writer.extractor",
        "extension": { "name": "@scope/writer-extension", "version": "1.2.3" }
    });
    let relation_id = "relation:prompt.uses_context:prompt:writer:context:brand";
    let policies = built_in_relation_policy_table();
    let output = finalize_static_index_values_with_policies(
        &[json!({
            "definitions": [
                { "id": "prompt:writer", "kind": "prompt", "name": "writer", "fidelity": "resolved" },
                { "id": "context:brand", "kind": "context", "name": "brand", "fidelity": "resolved" }
            ],
            "relationRefs": [{
                "ownerDefinitionId": "prompt:writer",
                "type": "prompt.uses_context",
                "fromId": "prompt:writer",
                "toId": "context:brand",
                "extractors": [contributor.clone()]
            }],
            "sourceRefs": [{
                "definitionId": "prompt:writer",
                "ref": {
                    "id": "source-ref:writer-schema",
                    "role": "schema",
                    "source": { "file": "src/writer.ts", "line": 2, "column": 3 },
                    "fidelity": "resolved"
                }
            }],
            "diagnostics": [{
                "id": "diagnostic:writer",
                "severity": "warning",
                "code": "extension.writer_partial",
                "message": "Writer metadata is partial."
            }],
            "factExtractors": {
                "definitions:prompt:writer": [contributor.clone()],
                "sourceRefs:prompt:writer:source-ref:writer-schema": [contributor.clone()],
                "diagnostics:diagnostic:writer": [contributor.clone()]
            }
        })],
        &[],
        &policies,
    );
    let events = project_patch_events(
        &output,
        &StaticIndexFinalizeProject {
            root: "/repo".to_string(),
            project_name: None,
        },
        "test",
        StaticIndexFinalizeEventOptions {
            phase: "ast",
            invalidates: None,
        },
    );
    let facts = events
        .iter()
        .filter(|event| event["type"] == "fact:batch")
        .flat_map(|event| event["facts"].as_array().expect("batch facts"))
        .collect::<Vec<_>>();

    let relation_fact_id = format!("relations:{relation_id}");
    for (kind, fact_id) in [
        ("definitions", "definitions:prompt:writer"),
        ("relations", relation_fact_id.as_str()),
        ("sourceRefs", "sourceRefs:3"),
        ("diagnostics", "diagnostics:diagnostic:writer"),
    ] {
        let envelope = facts
            .iter()
            .find(|fact| fact["kind"] == kind && fact["factId"] == fact_id)
            .unwrap_or_else(|| panic!("missing {kind} envelope {fact_id}"));
        assert_eq!(
            envelope["provenance"]["extractors"],
            json!([contributor.clone()])
        );
        assert_eq!(
            envelope["producer"]["name"],
            "@use-crux/indexer/project-indexer"
        );
    }

    let brand = facts
        .iter()
        .find(|fact| fact["factId"] == "definitions:context:brand")
        .expect("unattributed definition");
    assert!(brand["provenance"].get("extractors").is_none());
}
