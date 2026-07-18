use crate::core::facts::{StaticIndexFidelity, StaticIndexPatchFacts, StaticIndexRelationRef};
use crate::relation::model::{
    StaticIndexRelationPolicyTable, built_in_relation_policy_table,
    resolve_static_index_relation_model,
};
use crate::relation::policy::StaticIndexRelationPolicy;
use crate::relation::tests::{definition, relation_ref};

#[test]
fn missing_policy_is_conserved_as_unresolved_reference_and_diagnostic() {
    let facts = StaticIndexPatchFacts {
        root: None,
        project_name: None,
        definitions: vec![definition(
            "prompt:writer",
            "prompt",
            "writer",
            StaticIndexFidelity::Partial,
            None,
        )],
        relation_refs: vec![StaticIndexRelationRef {
            to_variable: Some("missingThing".to_string()),
            ..relation_ref("prompt:writer", "unknown.uses_thing")
        }],
        ..Default::default()
    };

    let model = resolve_static_index_relation_model(facts, &built_in_relation_policy_table());

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
    let facts = StaticIndexPatchFacts {
        root: None,
        project_name: None,
        definitions: vec![definition(
            "eval:coverage",
            "eval",
            "quality",
            StaticIndexFidelity::Partial,
            None,
        )],
        relation_refs: vec![
            StaticIndexRelationRef {
                from_id: Some("eval:coverage".to_string()),
                to_id: Some("eval.case:quality:refund".to_string()),
                ..relation_ref("eval:coverage", "eval.includes_case")
            },
            StaticIndexRelationRef {
                from_id: Some("eval:coverage".to_string()),
                to_id: Some("eval.case:quality:refund".to_string()),
                ..relation_ref("eval:coverage", "eval.includes_case")
            },
        ],
        ..Default::default()
    };

    let model = resolve_static_index_relation_model(facts, &built_in_relation_policy_table());

    assert_eq!(model.report.policy_gaps[0].count, 1);
    let policy_diagnostic = model
        .facts
        .diagnostics
        .iter()
        .find(|diagnostic| diagnostic.code == "relation.policy_gap")
        .expect("policy gap diagnostic");
    assert_eq!(
        policy_diagnostic.message,
        "No relation policy matched 1 \"eval.includes_case\" relation reference(s)."
    );
}

#[test]
fn missing_policy_gap_count_keeps_first_owner_scope() {
    let facts = StaticIndexPatchFacts {
        root: None,
        project_name: None,
        definitions: vec![
            definition(
                "eval:first",
                "eval",
                "first",
                StaticIndexFidelity::Partial,
                None,
            ),
            definition(
                "eval:second",
                "eval",
                "second",
                StaticIndexFidelity::Partial,
                None,
            ),
        ],
        relation_refs: vec![
            StaticIndexRelationRef {
                from_id: Some("eval:first".to_string()),
                to_id: Some("eval.case:first:a".to_string()),
                ..relation_ref("eval:first", "eval.includes_case")
            },
            StaticIndexRelationRef {
                from_id: Some("eval:second".to_string()),
                to_id: Some("eval.case:second:b".to_string()),
                ..relation_ref("eval:second", "eval.includes_case")
            },
        ],
        ..Default::default()
    };

    let model = resolve_static_index_relation_model(facts, &built_in_relation_policy_table());

    assert_eq!(model.report.policy_gaps[0].count, 1);
    assert_eq!(
        model.report.policy_gaps[0].sample_fact.owner_definition_id,
        "eval:first"
    );
}

#[test]
fn policy_table_reports_duplicate_types_without_throwing() {
    let policy = StaticIndexRelationPolicy {
        r#type: "prompt.uses_context".to_string(),
        from_kinds: vec!["prompt".to_string()],
        to_kinds: vec!["context".to_string()],
        presentation: "both".to_string(),
        partial: true,
        runtime_join: true,
    };
    let table = StaticIndexRelationPolicyTable::new(vec![vec![policy.clone()], vec![policy]]);

    assert!(table.policy_for("prompt.uses_context").is_some());
    assert_eq!(table.validation.len(), 1);
    assert_eq!(table.validation[0].code, "relation.policy_table_invalid");
}
