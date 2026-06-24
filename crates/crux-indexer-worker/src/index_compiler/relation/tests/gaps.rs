use crate::index_compiler::core::facts::{
    NativeStaticFidelity, NativeStaticIndexPatchFacts, NativeStaticRelationRef,
};
use crate::index_compiler::relation::model::{
    NativeStaticRelationPolicyTable, built_in_relation_policy_table,
    resolve_native_static_relation_model,
};
use crate::index_compiler::relation::policy::NativeStaticRelationPolicy;
use crate::index_compiler::relation::tests::{definition, relation_ref};

#[test]
fn missing_policy_is_conserved_as_unresolved_reference_and_diagnostic() {
    let facts = NativeStaticIndexPatchFacts {
        root: None,
        project_name: None,
        definitions: vec![definition(
            "prompt:writer",
            "prompt",
            "writer",
            NativeStaticFidelity::Partial,
            None,
        )],
        relation_refs: vec![NativeStaticRelationRef {
            to_variable: Some("missingThing".to_string()),
            ..relation_ref("prompt:writer", "unknown.uses_thing")
        }],
        ..Default::default()
    };

    let model = resolve_native_static_relation_model(facts, &built_in_relation_policy_table());

    assert!(model.facts.relations.is_empty());
    assert_eq!(model.report.unresolved[0].reason, "no-policy");
    assert_eq!(model.report.policy_gaps[0].r#type, "unknown.uses_thing");
    assert_eq!(
        model
            .facts
            .diagnostics
            .iter()
            .map(|diagnostic| diagnostic.code.as_str())
            .collect::<Vec<_>>(),
        vec!["relation.unresolved_reference", "relation.policy_gap"]
    );
}

#[test]
fn duplicate_missing_policy_refs_count_once_per_relation_identity() {
    let facts = NativeStaticIndexPatchFacts {
        root: None,
        project_name: None,
        definitions: vec![definition(
            "evaluation:quality",
            "evaluation",
            "quality",
            NativeStaticFidelity::Partial,
            None,
        )],
        relation_refs: vec![
            NativeStaticRelationRef {
                from_id: Some("evaluation:quality".to_string()),
                to_id: Some("evaluation.case:quality:refund".to_string()),
                ..relation_ref("evaluation:quality", "evaluation.includes_case")
            },
            NativeStaticRelationRef {
                from_id: Some("evaluation:quality".to_string()),
                to_id: Some("evaluation.case:quality:refund".to_string()),
                ..relation_ref("evaluation:quality", "evaluation.includes_case")
            },
        ],
        ..Default::default()
    };

    let model = resolve_native_static_relation_model(facts, &built_in_relation_policy_table());

    assert_eq!(model.report.policy_gaps[0].count, 1);
    let policy_diagnostic = model
        .facts
        .diagnostics
        .iter()
        .find(|diagnostic| diagnostic.code == "relation.policy_gap")
        .expect("policy gap diagnostic");
    assert_eq!(
        policy_diagnostic.message,
        "No relation policy matched 1 \"evaluation.includes_case\" relation reference(s)."
    );
}

#[test]
fn missing_policy_gap_count_keeps_first_owner_scope() {
    let facts = NativeStaticIndexPatchFacts {
        root: None,
        project_name: None,
        definitions: vec![
            definition(
                "evaluation:first",
                "evaluation",
                "first",
                NativeStaticFidelity::Partial,
                None,
            ),
            definition(
                "evaluation:second",
                "evaluation",
                "second",
                NativeStaticFidelity::Partial,
                None,
            ),
        ],
        relation_refs: vec![
            NativeStaticRelationRef {
                from_id: Some("evaluation:first".to_string()),
                to_id: Some("evaluation.case:first:a".to_string()),
                ..relation_ref("evaluation:first", "evaluation.includes_case")
            },
            NativeStaticRelationRef {
                from_id: Some("evaluation:second".to_string()),
                to_id: Some("evaluation.case:second:b".to_string()),
                ..relation_ref("evaluation:second", "evaluation.includes_case")
            },
        ],
        ..Default::default()
    };

    let model = resolve_native_static_relation_model(facts, &built_in_relation_policy_table());

    assert_eq!(model.report.policy_gaps[0].count, 1);
    assert_eq!(
        model.report.policy_gaps[0].sample_fact.owner_definition_id,
        "evaluation:first"
    );
}

#[test]
fn policy_table_reports_duplicate_types_without_throwing() {
    let policy = NativeStaticRelationPolicy {
        r#type: "prompt.uses_context".to_string(),
        from_kinds: vec!["prompt".to_string()],
        to_kinds: vec!["context".to_string()],
        presentation: "both".to_string(),
        partial: true,
        runtime_join: true,
    };
    let table = NativeStaticRelationPolicyTable::new(vec![vec![policy.clone()], vec![policy]]);

    assert!(table.policy_for("prompt.uses_context").is_some());
    assert_eq!(table.validation.len(), 1);
    assert_eq!(table.validation[0].code, "relation.policy_table_invalid");
}
