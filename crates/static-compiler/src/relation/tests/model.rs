use std::collections::BTreeMap;

use serde_json::json;

use crate::core::facts::{
    StaticIndexDefinition, StaticIndexFidelity, StaticIndexPatchFacts, StaticIndexRelation,
    StaticIndexRelationRef,
};
use crate::relation::model::{
    StaticIndexRelationPolicyTable, built_in_relation_policy_table, merge_relations_by_identity,
    relation_identity, resolve_static_index_relation_model,
};
use crate::relation::policy::StaticIndexRelationPolicy;

#[test]
fn relation_identity_and_merge_match_project_index_contract() {
    let partial = relation(
        "legacy:id",
        "prompt.uses_context",
        "prompt:writer",
        "context:brand",
        StaticIndexFidelity::Partial,
    );
    let resolved = relation(
        "other:id",
        "prompt.uses_context",
        "prompt:writer",
        "context:brand",
        StaticIndexFidelity::Resolved,
    );

    let merged = merge_relations_by_identity([partial, resolved]);

    assert_eq!(merged.len(), 1);
    assert_eq!(
        merged[0].id,
        "relation:prompt.uses_context:prompt:writer:context:brand"
    );
    assert_eq!(merged[0].fidelity, StaticIndexFidelity::Resolved);
    let mut first = relation(
        "first:id",
        "agent.uses_prompt",
        "agent:support",
        "prompt:support",
        StaticIndexFidelity::Resolved,
    );
    first.source = Some(crate::core::facts::StaticIndexSourceLocation {
        file: "src/a.ts".to_string(),
        line: 1,
        column: Some(1),
        function_name: None,
    });
    let mut second = relation(
        "second:id",
        "agent.uses_prompt",
        "agent:support",
        "prompt:support",
        StaticIndexFidelity::Resolved,
    );
    second.source = Some(crate::core::facts::StaticIndexSourceLocation {
        file: "src/b.ts".to_string(),
        line: 1,
        column: Some(1),
        function_name: None,
    });
    let equal_fidelity = merge_relations_by_identity([first, second]);

    assert_eq!(
        equal_fidelity[0]
            .source
            .as_ref()
            .map(|source| source.file.as_str()),
        Some("src/a.ts")
    );
    assert_eq!(
        relation_identity("prompt.uses_context", "prompt:writer", "context:brand"),
        "relation:prompt.uses_context:prompt:writer:context:brand"
    );
}

#[test]
fn relation_refs_bind_and_project_injection_read_model_metadata() {
    let prompt = definition(
        "prompt:writer",
        "prompt",
        "writer",
        StaticIndexFidelity::Partial,
        Some(json!({
            "facts": {
                "kind": "prompt",
                "useEntries": [{ "variable": "brandContext", "relationHint": "context" }]
            }
        })),
    );
    let context = definition(
        "context:brand-context",
        "context",
        "Brand Context",
        StaticIndexFidelity::Resolved,
        Some(json!({ "exportName": "brandContext" })),
    );
    let facts = StaticIndexPatchFacts {
        root: None,
        project_name: None,
        definitions: vec![prompt, context],
        relation_refs: vec![StaticIndexRelationRef {
            to_variable: Some("brandContext".to_string()),
            ..relation_ref("prompt:writer", "prompt.uses_context")
        }],
        ..Default::default()
    };

    let model = resolve_static_index_relation_model(facts, &built_in_relation_policy_table());

    assert_eq!(model.report.counts.resolved, 1);
    assert_eq!(model.report.counts.unresolved, 0);
    assert_eq!(
        model.facts.relations[0].id,
        "relation:prompt.uses_context:prompt:writer:context:brand-context"
    );
    let prompt = model
        .facts
        .definitions
        .iter()
        .find(|definition| definition.id == "prompt:writer")
        .expect("prompt should remain in definitions");
    let metadata = prompt.metadata.as_ref().expect("prompt should be enriched");
    assert_eq!(
        metadata["intelligence"]["dependencies"]["contexts"],
        json!(["context:brand-context"])
    );
    assert_eq!(
        metadata["facts"]["useEntries"][0]["targetDefinitionId"],
        "context:brand-context"
    );
    assert_eq!(metadata["facts"]["useEntries"][0]["targetKind"], "context");
    assert_eq!(
        metadata["facts"]["useEntries"][0]["relationFidelity"],
        "partial"
    );
}

#[test]
fn eval_coverage_refs_do_not_resolve_through_project_wide_variable_fallback() {
    let facts = StaticIndexPatchFacts {
        root: None,
        project_name: None,
        definitions: vec![
            definition(
                "evaluation:classify-check",
                "evaluation",
                "classify-check",
                StaticIndexFidelity::Resolved,
                None,
            ),
            definition(
                "prompt:classify",
                "prompt",
                "classify",
                StaticIndexFidelity::Resolved,
                Some(json!({ "exportName": "classify" })),
            ),
        ],
        relation_refs: vec![StaticIndexRelationRef {
            from_id: Some("evaluation:classify-check".to_string()),
            to_variable: Some("classify".to_string()),
            ..relation_ref("evaluation:classify-check", "eval.covers_definition")
        }],
        ..Default::default()
    };

    let policies = StaticIndexRelationPolicyTable::new(vec![vec![StaticIndexRelationPolicy {
        r#type: "eval.covers_definition".to_string(),
        from_kinds: vec!["evaluation".to_string()],
        to_kinds: vec!["prompt".to_string()],
        presentation: "both".to_string(),
        partial: true,
        runtime_join: true,
    }]]);
    let model = resolve_static_index_relation_model(facts, &policies);

    assert!(model.facts.relations.is_empty());
    assert_eq!(model.report.unresolved[0].reason, "no-fallback-id");
}

#[test]
fn routing_target_relations_project_child_target_metadata() {
    let facts = StaticIndexPatchFacts {
        root: None,
        project_name: None,
        definitions: vec![definition(
            "routing.router.route:support",
            "routing.router.route",
            "support",
            StaticIndexFidelity::Partial,
            None,
        )],
        relation_refs: vec![StaticIndexRelationRef {
            to_id: Some("agent:support".to_string()),
            ..relation_ref("routing.router.route:support", "router.route.uses_agent")
        }],
        ..Default::default()
    };

    let model = resolve_static_index_relation_model(facts, &built_in_relation_policy_table());
    let route = &model.facts.definitions[0];

    assert_eq!(route.metadata.as_ref().unwrap()["targetKind"], "agent");
    assert_eq!(
        route.metadata.as_ref().unwrap()["targetDefinitionId"],
        "agent:support"
    );
}

pub(crate) fn relation_ref(
    owner_definition_id: &str,
    relation_type: &str,
) -> StaticIndexRelationRef {
    StaticIndexRelationRef {
        owner_definition_id: owner_definition_id.to_string(),
        r#type: relation_type.to_string(),
        type_by_target_kind: BTreeMap::new(),
        from_id: None,
        from_variable: None,
        to_id: None,
        to_variable: None,
        fallback_to_id: None,
        source: None,
        metadata: None,
    }
}

pub(crate) fn definition(
    id: &str,
    kind: &str,
    name: &str,
    fidelity: StaticIndexFidelity,
    metadata: Option<serde_json::Value>,
) -> StaticIndexDefinition {
    StaticIndexDefinition {
        id: id.to_string(),
        kind: kind.to_string(),
        name: name.to_string(),
        description: None,
        tags: Vec::new(),
        path: Vec::new(),
        source: None,
        source_snippet: None,
        source_refs: Vec::new(),
        fidelity,
        status: Some("active".to_string()),
        fingerprint: None,
        metadata,
        quality: None,
    }
}

pub(crate) fn relation(
    id: &str,
    relation_type: &str,
    from: &str,
    to: &str,
    fidelity: StaticIndexFidelity,
) -> StaticIndexRelation {
    StaticIndexRelation {
        id: id.to_string(),
        r#type: relation_type.to_string(),
        from: from.to_string(),
        to: to.to_string(),
        fidelity,
        source: None,
        metadata: None,
    }
}
