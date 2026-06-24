use serde_json::json;

use crate::index_compiler::relation::model::{
    relation_policy_table_from_value, relation_policy_table_from_value_with_builtins,
};

#[test]
fn relation_policy_table_accepts_typescript_relation_specs() {
    let table = relation_policy_table_from_value(Some(&json!([
        {
            "type": "workflow.includes_step",
            "fromKinds": ["workflow"],
            "toKinds": ["workflow.step"],
            "presentation": "edge",
            "fidelity": "resolved",
            "runtimeJoin": false
        }
    ])))
    .expect("TypeScript relation specs should parse");
    let policy = table
        .policy_for("workflow.includes_step")
        .expect("policy should be registered");

    assert_eq!(policy.from_kinds, vec!["workflow"]);
    assert_eq!(policy.to_kinds, vec!["workflow.step"]);
    assert_eq!(policy.presentation, "edge");
    assert!(!policy.partial);
    assert!(!policy.runtime_join);
}

#[test]
fn relation_specs_wrapper_accepts_typescript_manifest_shape() {
    let table = relation_policy_table_from_value(Some(&json!({
        "relations": [
            {
                "type": "workflow.includes_step",
                "fromKinds": ["workflow"],
                "toKinds": ["workflow.step"],
                "presentation": "detail",
                "fidelity": "partial",
                "runtimeJoin": true
            }
        ]
    })))
    .expect("manifest relation specs should parse");

    assert!(table.policy_for("workflow.includes_step").is_some());
}

#[test]
fn extension_relation_specs_are_added_after_built_ins() {
    let table = relation_policy_table_from_value_with_builtins(Some(&json!([
        {
            "type": "@acme/workflow/uses_tool",
            "fromKinds": ["@acme/workflow"],
            "toKinds": ["tool"],
            "presentation": "edge",
            "fidelity": "partial"
        }
    ])));

    assert!(table.policy_for("prompt.uses_context").is_some());
    assert!(table.policy_for("@acme/workflow/uses_tool").is_some());
}
