use serde_json::json;

use crate::static_compiler::finalizer::events::{
    NativeStaticFinalizeEventOptions, NativeStaticFinalizeProject, project_patch_events,
};
use crate::static_compiler::finalizer::run::finalize_native_static_values_with_policies;
use crate::static_compiler::relation::model::built_in_relation_policy_table;

#[test]
fn project_patch_events_chunks_fact_batches() {
    let definitions = (0..205)
        .map(|index| {
            json!({
                "id": format!("prompt:item-{index}"),
                "kind": "prompt",
                "name": format!("item-{index}"),
                "fidelity": "resolved",
                "status": "active",
                "metadata": { "inputSchema": { "type": "object" } },
                "quality": { "evalIds": [format!("eval:item-{index}")] }
            })
        })
        .collect::<Vec<_>>();
    let policies = built_in_relation_policy_table();
    let output = finalize_native_static_values_with_policies(
        &[json!({ "definitions": definitions })],
        &[],
        &policies,
    );
    let events = project_patch_events(
        &output,
        &NativeStaticFinalizeProject {
            root: "/repo".to_string(),
            project_name: None,
        },
        "test",
        NativeStaticFinalizeEventOptions {
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
        34
    );
    assert_eq!(
        events.last().expect("phase done")["summary"]["factCount"],
        234
    );
    assert_eq!(
        events.last().expect("phase done")["summary"]["decision"]["nativeStaticComplete"],
        true
    );
}

#[test]
fn project_patch_events_can_materialize_quality_phase_without_invalidation() {
    let policies = built_in_relation_policy_table();
    let output = finalize_native_static_values_with_policies(
        &[json!({
            "definitions": [{
                "id": "quality-target:writer",
                "kind": "quality.target",
                "name": "writer",
                "fidelity": "resolved",
                "quality": { "experimentIds": ["experiment:writer"] }
            }]
        })],
        &[],
        &policies,
    );
    let events = project_patch_events(
        &output,
        &NativeStaticFinalizeProject {
            root: "/repo".to_string(),
            project_name: Some("fixture".to_string()),
        },
        "test",
        NativeStaticFinalizeEventOptions {
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
