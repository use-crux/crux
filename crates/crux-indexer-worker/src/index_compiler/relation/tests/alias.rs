use std::collections::BTreeMap;

use serde_json::json;

use crate::index_compiler::core::facts::{
    NativeStaticDefinition, NativeStaticFidelity, NativeStaticIndexPatchFacts,
    NativeStaticRelationRef,
};
use crate::index_compiler::relation::model::{
    built_in_relation_policy_table, resolve_native_static_relation_model,
};

#[test]
fn relation_ref_aliases_enrich_duplicate_target_use_entries() {
    let facts = NativeStaticIndexPatchFacts {
        root: None,
        project_name: None,
        definitions: vec![
            definition(
                "prompt:answer",
                "prompt",
                "answer",
                Some(json!({
                    "facts": {
                        "kind": "prompt",
                        "useEntries": [
                            { "variable": "locale", "relationHint": "context", "via": "direct" },
                            { "variable": "localeContext", "relationHint": "unknown", "via": "direct" }
                        ]
                    }
                })),
            ),
            definition(
                "context:locale",
                "context",
                "locale",
                Some(json!({ "exportName": "localeCtx", "facts": { "kind": "context" } })),
            ),
        ],
        relation_refs: vec![
            relation_ref("prompt:answer", "locale", "context:locale"),
            relation_ref("prompt:answer", "localeContext", "context:locale"),
        ],
        ..Default::default()
    };

    let model = resolve_native_static_relation_model(facts, &built_in_relation_policy_table());
    let prompt = model
        .facts
        .definitions
        .iter()
        .find(|definition| definition.id == "prompt:answer")
        .expect("prompt definition");
    let entries = prompt.metadata.as_ref().unwrap()["facts"]["useEntries"]
        .as_array()
        .expect("use entries");

    assert_eq!(model.facts.relations.len(), 1);
    assert_eq!(entries[0]["targetDefinitionId"], "context:locale");
    assert_eq!(entries[1]["targetDefinitionId"], "context:locale");
    assert_eq!(entries[1]["targetKind"], "context");
    assert_eq!(entries[1]["relationFidelity"], "resolved");
}

#[test]
fn relation_ref_aliases_do_not_enrich_duplicate_resolved_variables() {
    let facts = NativeStaticIndexPatchFacts {
        root: None,
        project_name: None,
        definitions: vec![
            definition(
                "prompt:branching",
                "prompt",
                "branching",
                Some(json!({
                    "facts": {
                        "kind": "prompt",
                        "useEntries": [
                            {
                                "variable": "flag",
                                "relationHint": "context",
                                "targetDefinitionId": "context:flag",
                                "targetKind": "context",
                                "targetName": "flag",
                                "relationType": "prompt.uses_context",
                                "relationFidelity": "resolved",
                                "via": "match",
                                "conditionality": "match-case"
                            },
                            { "variable": "flag", "relationHint": "unknown", "via": "direct" }
                        ]
                    }
                })),
            ),
            definition(
                "context:flag",
                "context",
                "flag",
                Some(json!({ "facts": { "kind": "context" } })),
            ),
        ],
        relation_refs: vec![relation_ref("prompt:branching", "flag", "context:flag")],
        ..Default::default()
    };

    let model = resolve_native_static_relation_model(facts, &built_in_relation_policy_table());
    let prompt = model
        .facts
        .definitions
        .iter()
        .find(|definition| definition.id == "prompt:branching")
        .expect("prompt definition");
    let entries = prompt.metadata.as_ref().unwrap()["facts"]["useEntries"]
        .as_array()
        .expect("use entries");

    assert_eq!(entries[0]["targetDefinitionId"], "context:flag");
    assert!(entries[1].get("targetDefinitionId").is_none());
}

fn relation_ref(owner: &str, variable: &str, to_id: &str) -> NativeStaticRelationRef {
    NativeStaticRelationRef {
        owner_definition_id: owner.to_string(),
        r#type: "prompt.uses_context".to_string(),
        type_by_target_kind: BTreeMap::new(),
        from_id: Some(owner.to_string()),
        from_variable: None,
        to_id: Some(to_id.to_string()),
        to_variable: Some(variable.to_string()),
        fallback_to_id: None,
        source: None,
        metadata: None,
    }
}

fn definition(
    id: &str,
    kind: &str,
    name: &str,
    metadata: Option<serde_json::Value>,
) -> NativeStaticDefinition {
    NativeStaticDefinition {
        id: id.to_string(),
        kind: kind.to_string(),
        name: name.to_string(),
        description: None,
        tags: Vec::new(),
        path: Vec::new(),
        source: None,
        source_snippet: None,
        source_refs: Vec::new(),
        fidelity: NativeStaticFidelity::Resolved,
        status: Some("active".to_string()),
        fingerprint: None,
        metadata,
        quality: None,
    }
}
