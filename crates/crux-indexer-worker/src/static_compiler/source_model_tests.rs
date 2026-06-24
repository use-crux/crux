use serde_json::json;

use crate::static_compiler::finalize::finalize_native_static_values;
use crate::static_compiler::finalize_events::{
    NativeStaticFinalizeEventOptions, NativeStaticFinalizeProject, project_patch_events,
};

#[test]
fn finalization_folds_source_refs_into_definitions() {
    let output = finalize_native_static_values(
        &[json!({
            "definitions": [{
                "id": "prompt:writer",
                "kind": "prompt",
                "name": "writer",
                "fidelity": "resolved",
                "status": "active",
                "source": { "file": "/repo/src/writer.ts", "line": 1 }
            }],
            "sourceRefs": [{
                "definitionId": "prompt:writer",
                "ref": {
                    "id": "prompt:writer:schema",
                    "role": "schema",
                    "property": "inputSchema",
                    "source": { "file": "/repo/src/writer.ts", "line": 3 },
                    "fidelity": "partial"
                }
            }]
        })],
        &[],
    );

    let definition = output
        .model
        .facts
        .definitions
        .iter()
        .find(|definition| definition.id == "prompt:writer")
        .expect("definition should exist");
    assert_eq!(definition.source_refs.len(), 1);
    assert_eq!(definition.source_refs[0].id, "prompt:writer:schema");
    assert!(output.model.facts.source_refs.is_empty());
    assert_eq!(output.counts.source_refs, 0);
}

#[test]
fn finalization_derives_source_rows_and_source_graph() {
    let output = finalize_native_static_values(
        &[json!({
            "definitions": [{
                "id": "prompt:writer",
                "kind": "prompt",
                "name": "writer",
                "fidelity": "resolved",
                "status": "active",
                "source": { "file": "/repo/src/writer.ts", "line": 1 }
            }],
            "diagnostics": [{
                "id": "diagnostic:writer",
                "severity": "warning",
                "code": "test.warning",
                "message": "Test warning.",
                "source": { "file": "/repo/src/writer.ts", "line": 2 },
                "relatedDefinitionIds": ["prompt:writer"]
            }],
            "sources": [{
                "file": "/repo/src/writer.ts",
                "status": "indexed",
                "dependencies": ["/repo/src/context.ts"]
            }]
        })],
        &[],
    );

    let writer = output
        .model
        .facts
        .sources
        .iter()
        .find(|source| source.file == "/repo/src/writer.ts")
        .expect("writer source row should exist");
    assert_eq!(writer.status, "partial");
    assert_eq!(writer.definition_ids, vec!["prompt:writer"]);
    assert_eq!(writer.dependencies, vec!["/repo/src/context.ts"]);
    assert_eq!(writer.diagnostics, vec!["diagnostic:writer"]);

    let context = output
        .model
        .facts
        .sources
        .iter()
        .find(|source| source.file == "/repo/src/context.ts")
        .expect("dependency source row should exist");
    assert_eq!(context.status, "indexed");
    assert_eq!(context.dependents, vec!["/repo/src/writer.ts"]);

    let source_graph = output
        .model
        .facts
        .source_graph
        .expect("source graph should be materialized");
    assert_eq!(source_graph.schema_version, 1);
    assert_eq!(source_graph.produced_by, "@crux/indexer");
    assert_eq!(
        source_graph.capabilities,
        vec![
            "definition-ownership",
            "diagnostic-ownership",
            "source-dependencies",
            "source-dependents"
        ]
    );
    assert_eq!(output.counts.sources, 2);
    assert_eq!(output.counts.source_graph, 1);
}

#[test]
fn finalization_adds_source_ref_cross_file_dependencies() {
    let output = finalize_native_static_values(
        &[json!({
            "definitions": [{
                "id": "prompt:writer",
                "kind": "prompt",
                "name": "writer",
                "fidelity": "resolved",
                "status": "active",
                "source": { "file": "/repo/src/writer.ts", "line": 1 },
                "sourceRefs": [{
                    "id": "prompt:writer:source:schema:inputSchema",
                    "role": "schema",
                    "property": "inputSchema",
                    "source": { "file": "/repo/src/schema.ts", "line": 4 },
                    "fidelity": "partial"
                }]
            }]
        })],
        &[],
    );

    let writer = output
        .model
        .facts
        .sources
        .iter()
        .find(|source| source.file == "/repo/src/writer.ts")
        .expect("writer source row should exist");
    assert_eq!(writer.dependencies, vec!["/repo/src/schema.ts"]);

    let schema = output
        .model
        .facts
        .sources
        .iter()
        .find(|source| source.file == "/repo/src/schema.ts")
        .expect("schema dependency row should exist");
    assert_eq!(schema.dependents, vec!["/repo/src/writer.ts"]);
}

#[test]
fn source_graph_event_uses_worker_fact_id_convention() {
    let output = finalize_native_static_values(
        &[json!({
            "definitions": [{
                "id": "prompt:writer",
                "kind": "prompt",
                "name": "writer",
                "fidelity": "resolved",
                "status": "active",
                "source": { "file": "/repo/src/writer.ts", "line": 1 }
            }]
        })],
        &[],
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
    let source_graph = events
        .iter()
        .filter_map(|event| event["facts"].as_array())
        .flatten()
        .find(|fact| fact["kind"] == "sourceGraph")
        .expect("sourceGraph envelope should exist");

    assert_eq!(source_graph["factId"], "sourceGraph:0");
}

#[test]
fn source_rows_use_source_graph_shards() {
    let output = finalize_native_static_values(
        &[json!({
            "definitions": [{
                "id": "prompt:web",
                "kind": "prompt",
                "name": "web",
                "fidelity": "resolved",
                "status": "active",
                "source": { "file": "/repo/apps/web/src/prompt.ts", "line": 1 }
            }],
            "sourceGraph": {
                "schemaVersion": 1,
                "producedBy": "@crux/indexer",
                "capabilities": [
                    "source-dependencies",
                    "source-dependents",
                    "definition-ownership",
                    "diagnostic-ownership",
                    "project-shards"
                ],
                "shards": [
                    { "id": ".", "root": "/repo" },
                    { "id": "apps/web", "root": "/repo/apps/web", "name": "@fixture/web" }
                ]
            }
        })],
        &[],
    );

    let web = output
        .model
        .facts
        .sources
        .iter()
        .find(|source| source.file == "/repo/apps/web/src/prompt.ts")
        .expect("web source row should exist");
    assert_eq!(web.shard_id.as_deref(), Some("apps/web"));
    assert!(output.model.facts.source_graph.is_some_and(|source_graph| {
        source_graph
            .capabilities
            .contains(&"project-shards".to_string())
            && source_graph
                .shards
                .is_some_and(|shards| shards.iter().any(|shard| shard.id == "apps/web"))
    }));
}
