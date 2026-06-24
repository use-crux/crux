use serde_json::json;

use crate::static_compiler::finalize::{
    finalize_native_static_values, finalize_native_static_values_with_policies,
};
use crate::static_compiler::relations::relation_policy_table_from_value;

#[test]
fn finalize_binds_grouped_relation_refs_and_emits_fact_batch() {
    let output = finalize_native_static_values(
        &[json!({
            "definitions": [
                {
                    "id": "prompt:writer",
                    "kind": "prompt",
                    "name": "writer",
                    "fidelity": "partial",
                    "status": "active",
                    "metadata": {
                        "facts": {
                            "kind": "prompt",
                            "useEntries": [{ "variable": "brandContext" }]
                        }
                    }
                },
                {
                    "id": "context:brand-context",
                    "kind": "context",
                    "name": "Brand Context",
                    "fidelity": "resolved",
                    "status": "active",
                    "metadata": { "exportName": "brandContext" }
                }
            ],
            "relationRefs": [
                {
                    "ownerDefinitionId": "prompt:writer",
                    "type": "prompt.uses_context",
                    "toVariable": "brandContext"
                }
            ]
        })],
        &[],
    );

    assert_eq!(output.model.report.counts.resolved, 1);
    assert_eq!(output.events.len(), 1);
    assert_eq!(output.events[0]["type"], "fact:batch");
    let facts = output.events[0]["facts"].as_array().expect("batch facts");
    assert!(facts.iter().any(|fact| {
        fact["kind"] == "relations"
            && fact["fact"]["id"]
                == "relation:prompt.uses_context:prompt:writer:context:brand-context"
    }));
    assert!(facts.iter().any(|fact| {
        fact["kind"] == "definitions"
            && fact["fact"]["id"] == "prompt:writer"
            && fact["fact"]["metadata"]["intelligence"]["dependencies"]["contexts"]
                == json!(["context:brand-context"])
    }));
}

#[test]
fn finalize_keeps_placeholder_phase_three_facts_non_materialized() {
    let output = finalize_native_static_values(
        &[
            json!({ "kind": "definition", "id": "definition:prompt:refundPrompt" }),
            json!({ "kind": "relation", "id": "relation:uses:a:b" }),
        ],
        &[],
    );

    assert!(output.events.is_empty());
    assert_eq!(output.model.report.counts.resolved, 0);
}

#[test]
fn finalize_uses_manifest_relation_policies_for_extension_facts() {
    let policies = relation_policy_table_from_value(Some(&json!({
        "relations": [
            {
                "type": "agent.uses_widget",
                "fromKinds": ["agent"],
                "toKinds": ["tool"],
                "presentation": "both",
                "fidelity": "partial",
                "runtimeJoin": false
            }
        ]
    })))
    .expect("manifest relation policies should parse");

    let output = finalize_native_static_values_with_policies(
        &[json!({
            "definitions": [
                {
                    "id": "agent:support",
                    "kind": "agent",
                    "name": "support",
                    "fidelity": "resolved",
                    "status": "active"
                },
                {
                    "id": "tool:widget",
                    "kind": "tool",
                    "name": "widget",
                    "fidelity": "resolved",
                    "status": "active"
                }
            ],
            "relationRefs": [
                {
                    "ownerDefinitionId": "agent:support",
                    "type": "agent.uses_widget",
                    "toId": "tool:widget"
                }
            ]
        })],
        &[],
        &policies,
    );

    assert_eq!(output.model.report.counts.resolved, 1);
    assert_eq!(output.model.facts.relations[0].r#type, "agent.uses_widget");
}

#[test]
fn finalize_materializes_grouped_rule_descriptors() {
    let output = finalize_native_static_values(
        &[],
        &[json!({
            "ruleDescriptors": [{
                "id": "prompt.missing_input_schema",
                "source": "builtin",
                "title": "Prompt has no input schema",
                "description": "Prompt input schemas support replay and inspection.",
                "severity": "info"
            }]
        })],
    );

    assert_eq!(output.counts.rule_descriptors, 1);
    assert_eq!(
        output.model.facts.rule_descriptors[0].id,
        "prompt.missing_input_schema"
    );
    assert!(
        output.events[0]["facts"]
            .as_array()
            .is_some_and(|facts| { facts.iter().any(|fact| fact["kind"] == "ruleDescriptors") })
    );
}

#[test]
fn finalize_merges_duplicate_definitions_by_id() {
    let output = finalize_native_static_values(
        &[json!({
            "definitions": [
                {
                    "id": "context:brand",
                    "kind": "context",
                    "name": "brandCtx",
                    "fidelity": "resolved",
                    "status": "active",
                    "metadata": {
                        "exportName": "brandCtx",
                        "facts": {
                            "kind": "context",
                            "useEntries": [{ "variable": "voice" }]
                        }
                    },
                    "sourceRefs": [{
                        "id": "context:brand:schema",
                        "role": "schema",
                        "source": { "file": "context.ts", "line": 3 },
                        "fidelity": "resolved"
                    }]
                },
                {
                    "id": "context:brand",
                    "kind": "context",
                    "name": "Brand",
                    "path": ["brand", "voice"],
                    "fidelity": "partial",
                    "status": "active",
                    "metadata": {
                        "facts": {
                            "useEntries": [{ "variable": "tone" }]
                        }
                    },
                    "source": { "file": "tree.ts", "line": 10 }
                }
            ]
        })],
        &[],
    );

    assert_eq!(output.counts.definitions, 1);
    let definition = &output.model.facts.definitions[0];
    assert_eq!(definition.id, "context:brand");
    assert_eq!(definition.name, "brandCtx");
    assert_eq!(definition.path, vec!["brand", "voice"]);
    assert_eq!(
        definition
            .source
            .as_ref()
            .map(|source| source.file.as_str()),
        Some("tree.ts")
    );
    assert_eq!(definition.source_refs.len(), 1);
    assert_eq!(
        definition.metadata.as_ref().and_then(|metadata| {
            metadata
                .get("facts")
                .and_then(|facts| facts.get("useEntries"))
                .cloned()
        }),
        Some(json!([{ "variable": "tone" }, { "variable": "voice" }]))
    );
}

#[test]
fn finalize_emits_builtin_resource_write_without_read_lint() {
    let output = finalize_native_static_values(
        &[json!({
            "definitions": [
                {
                    "id": "agent:writer",
                    "kind": "agent",
                    "name": "Writer",
                    "fidelity": "resolved",
                    "status": "active",
                    "quality": { "evalIds": ["eval:writer"] }
                },
                {
                    "id": "memory:session",
                    "kind": "memory",
                    "name": "Session memory",
                    "fidelity": "resolved",
                    "status": "active",
                    "source": { "file": "memory.ts", "line": 4 }
                }
            ],
            "relations": [
                {
                    "id": "relation:agent.writes_memory:agent:writer:memory:session",
                    "type": "agent.writes_memory",
                    "from": "agent:writer",
                    "to": "memory:session",
                    "fidelity": "resolved",
                    "source": { "file": "agent.ts", "line": 12 }
                }
            ]
        })],
        &[],
    );

    assert_eq!(output.counts.lint_findings, 1);
    let finding = &output.model.facts.lint_findings[0];
    assert_eq!(finding.rule_id, "resource.write_without_read");
    assert_eq!(
        finding.id,
        "lint:resource.write_without_read:memory:session"
    );
    assert_eq!(
        finding.message,
        "memory \"Session memory\" receives writes but has no index-visible read path."
    );
}
