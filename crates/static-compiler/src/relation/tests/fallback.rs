use serde_json::json;

use crate::core::facts::StaticIndexFidelity;
use crate::finalizer::run::finalize_static_index_values;

#[test]
fn relation_refs_use_stable_fallback_target_ids() {
    let output = finalize_static_index_values(
        &[json!({
            "definitions": [{
                "id": "prompt:answer",
                "kind": "prompt",
                "name": "answer",
                "fidelity": "resolved",
                "status": "active"
            }],
            "relationRefs": [{
                "ownerDefinitionId": "prompt:answer",
                "type": "prompt.uses_context",
                "toVariable": "groundedDocs"
            }]
        })],
        &[],
    );

    assert_eq!(output.model.report.counts.resolved, 1);
    assert_eq!(output.model.facts.diagnostics, vec![]);
    assert_eq!(
        output.model.facts.relations[0].id,
        "relation:prompt.uses_context:prompt:answer:context:grounded-docs"
    );
    assert_eq!(
        output.model.facts.relations[0].fidelity,
        StaticIndexFidelity::Partial
    );
}

#[test]
fn composition_agent_refs_use_stable_fallback_ids_not_folded_children() {
    let output = finalize_static_index_values(
        &[json!({
            "definitions": [
                {
                    "id": "composition.parallel:parallel-75",
                    "kind": "composition.parallel",
                    "name": "parallel-75",
                    "fidelity": "resolved",
                    "status": "active"
                },
                {
                    "id": "composition.parallel:parallel-75:branch:enrich",
                    "kind": "composition.parallel.branch",
                    "name": "enrich",
                    "fidelity": "resolved",
                    "status": "active"
                }
            ],
            "relationRefs": [{
                "ownerDefinitionId": "composition.parallel:parallel-75",
                "type": "composition.uses_agent",
                "toVariable": "enrich"
            }]
        })],
        &[],
    );

    assert_eq!(output.model.report.counts.resolved, 1);
    assert_eq!(
        output.model.facts.relations[0].id,
        "relation:composition.uses_agent:composition.parallel:parallel-75:agent:enrich"
    );
    assert_eq!(
        output.model.facts.relations[0].fidelity,
        StaticIndexFidelity::Partial
    );
}

#[test]
fn routing_refs_do_not_bind_project_wide_export_name_collisions() {
    let output = finalize_static_index_values(
        &[json!({
            "definitions": [
                {
                    "id": "routing.fallback:fallback-149:option:1",
                    "kind": "routing.fallback.option",
                    "name": "option 1",
                    "fidelity": "resolved",
                    "status": "active"
                },
                {
                    "id": "agent:Editor",
                    "kind": "agent",
                    "name": "Editor",
                    "fidelity": "resolved",
                    "status": "active",
                    "metadata": { "exportName": "agent" }
                }
            ],
            "relationRefs": [{
                "ownerDefinitionId": "routing.fallback:fallback-149",
                "type": "fallback.option.uses_router",
                "typeByTargetKind": {
                    "agent": "fallback.option.uses_agent",
                    "prompt": "fallback.option.uses_prompt",
                    "routing.router": "fallback.option.uses_router",
                    "routing.cascade": "fallback.option.uses_cascade",
                    "routing.fallback": "fallback.option.uses_fallback"
                },
                "fromId": "routing.fallback:fallback-149:option:1",
                "toVariable": "agent"
            }]
        })],
        &[],
    );

    assert!(output.model.facts.relations.is_empty());
    assert_eq!(output.model.report.counts.unresolved, 1);
    assert_eq!(output.model.report.unresolved[0].reason, "no-fallback-id");
    assert_eq!(
        output.model.report.unresolved[0].fact.owner_definition_id,
        "routing.fallback:fallback-149:option:1"
    );
}
