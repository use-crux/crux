use serde_json::json;

use crate::analysis::run::attribute_native_fact_extractors;
use crate::core::facts::StaticIndexPatchFacts;
use crate::finalizer::events::{
    StaticIndexFinalizeEventOptions, StaticIndexFinalizeProject, project_patch_events,
};
use crate::finalizer::run::finalize_static_index_values_with_policies;
use crate::protocol::static_syntax::StaticNativeFactExtractorIdentity;
use crate::relation::model::built_in_relation_policy_table;

#[test]
fn native_replaces_attributes_each_emitted_fact_kind_without_stamping_unrelated_facts() {
    let mut native: StaticIndexPatchFacts = serde_json::from_value(json!({
        "definitions": [
            { "id": "prompt:writer", "kind": "prompt", "name": "writer", "fidelity": "resolved" },
            { "id": "context:brand", "kind": "context", "name": "brand", "fidelity": "resolved" }
        ],
        "relationRefs": [{
            "ownerDefinitionId": "prompt:writer",
            "type": "prompt.uses_context",
            "fromId": "prompt:writer",
            "toId": "context:brand"
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
            "code": "native.writer_partial",
            "message": "Writer metadata is partial."
        }]
    }))
    .expect("native fact group");
    attribute_native_fact_extractors(
        &mut native,
        &[StaticNativeFactExtractorIdentity {
            extension: "@use-crux/core".to_string(),
            extractor: "prompt".to_string(),
        }],
    );

    let output = finalize_static_index_values_with_policies(
        &[
            serde_json::to_value(native).expect("native facts"),
            json!({
                "definitions": [{
                    "id": "context:unrelated",
                    "kind": "context",
                    "name": "unrelated",
                    "fidelity": "resolved"
                }]
            }),
        ],
        &[],
        &built_in_relation_policy_table(),
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

    for (kind, matches_fact) in [
        ("definitions", ("id", "prompt:writer")),
        ("relations", ("type", "prompt.uses_context")),
        ("sourceRefs", ("definitionId", "prompt:writer")),
        ("diagnostics", ("id", "diagnostic:writer")),
    ] {
        let envelope = facts
            .iter()
            .find(|envelope| {
                envelope["kind"] == kind && envelope["fact"][matches_fact.0] == matches_fact.1
            })
            .unwrap_or_else(|| panic!("missing native {kind} envelope"));
        assert_eq!(
            envelope["provenance"]["extractors"],
            json!([{ "name": "prompt" }])
        );
    }

    let unrelated = facts
        .iter()
        .find(|envelope| envelope["fact"]["id"] == "context:unrelated")
        .expect("unrelated definition envelope");
    assert!(unrelated["provenance"].get("extractors").is_none());
}
