use std::collections::BTreeMap;

use serde_json::json;

use crate::static_compiler::core::facts::{
    NativeStaticDefinition, NativeStaticFidelity, NativeStaticIndexPatchFacts,
    NativeStaticRelationRef, NativeStaticSourceLocation,
};
use crate::static_compiler::relation::model::{
    NativeStaticRelationPolicyTable, resolve_native_static_relation_model,
};
use crate::static_compiler::relation::policy::NativeStaticRelationPolicy;

#[test]
fn relation_refs_honor_from_variable_target_kind_type_and_source() {
    let source = NativeStaticSourceLocation {
        file: "src/workflow.ts".to_string(),
        line: 12,
        column: Some(4),
        function_name: None,
    };
    let facts = NativeStaticIndexPatchFacts {
        definitions: vec![
            definition("workflow:daily", "workflow", "daily", None),
            definition(
                "workflow.step:compose",
                "workflow.step",
                "compose",
                Some(json!({ "exportName": "composeStep" })),
            ),
            definition(
                "tool:writer",
                "tool",
                "writer",
                Some(json!({ "exportName": "writerTool" })),
            ),
        ],
        relation_refs: vec![NativeStaticRelationRef {
            type_by_target_kind: BTreeMap::from([(
                "tool".to_string(),
                "workflow.step.uses_tool".to_string(),
            )]),
            from_variable: Some("composeStep".to_string()),
            to_variable: Some("writerTool".to_string()),
            source: Some(source.clone()),
            ..relation_ref("workflow:daily", "workflow.uses_target")
        }],
        ..Default::default()
    };
    let policies = NativeStaticRelationPolicyTable::new(vec![vec![NativeStaticRelationPolicy {
        r#type: "workflow.uses_target".to_string(),
        from_kinds: vec!["workflow.step".to_string()],
        to_kinds: vec!["tool".to_string()],
        presentation: "both".to_string(),
        partial: false,
        runtime_join: false,
    }]]);

    let model = resolve_native_static_relation_model(facts, &policies);

    assert_eq!(model.report.counts.resolved, 1);
    assert_eq!(model.facts.relations[0].r#type, "workflow.step.uses_tool");
    assert_eq!(model.facts.relations[0].from, "workflow.step:compose");
    assert_eq!(model.facts.relations[0].to, "tool:writer");
    assert_eq!(model.facts.relations[0].source, Some(source));
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

fn relation_ref(owner_definition_id: &str, relation_type: &str) -> NativeStaticRelationRef {
    NativeStaticRelationRef {
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
