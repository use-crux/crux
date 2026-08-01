use serde_json::{Value, json};

use crate::facts::{StaticIndexDiagnosticSeverity, StaticIndexPatchFacts};
use crate::filter::StaticIndexLintOptions;
use crate::findings::append_builtin_lint_findings;

fn facts(value: Value) -> StaticIndexPatchFacts {
    serde_json::from_value(value).expect("fixture facts decode")
}

#[test]
fn expand_relations_unknown_type_reports_declared_relation_vocabulary() {
    let mut facts = facts(json!({
        "definitions": [
            {
                "id": "knowledge.relation:citations", "kind": "knowledge.relation",
                "name": "citations", "fidelity": "resolved",
                "metadata": { "facts": { "kind": "knowledge.relation", "typeNames": ["cites", "supports"] } }
            },
            {
                "id": "rag.recipe:docs:step:expand-relations", "kind": "rag.recipe.step",
                "name": "expand-relations", "fidelity": "resolved",
                "source": { "file": "src/knowledge.ts", "line": 12 },
                "metadata": {
                    "recipeId": "rag.recipe:docs",
                    "stepId": "expand-relations",
                    "facts": {
                        "kind": "rag.recipe.step",
                        "stepId": "expand-relations",
                        "typeNames": ["cites", "contradicts"]
                    }
                }
            }
        ]
    }));

    append_builtin_lint_findings(&mut facts, &StaticIndexLintOptions::default());

    let finding = facts
        .lint_findings
        .iter()
        .find(|finding| finding.rule_id == "expand-relations-unknown-type")
        .expect("expandRelations unknown type finding");
    assert_eq!(finding.severity, StaticIndexDiagnosticSeverity::Warning);
    assert_eq!(
        finding.message,
        "expandRelations() selects unknown relation type \"contradicts\"; declared relation vocabulary: \"cites\", \"supports\"."
    );
    assert_eq!(
        finding.extra["primaryDefinitionId"],
        "rag.recipe:docs:step:expand-relations"
    );
}

#[test]
fn expand_relations_declared_type_selection_is_clean() {
    let mut facts = facts(json!({
        "definitions": [
            {
                "id": "knowledge.relation:citations", "kind": "knowledge.relation",
                "name": "citations", "fidelity": "resolved",
                "metadata": { "facts": { "kind": "knowledge.relation", "typeNames": ["cites"] } }
            },
            {
                "id": "rag.recipe:docs:step:expand-relations", "kind": "rag.recipe.step",
                "name": "expand-relations", "fidelity": "resolved",
                "metadata": {
                    "recipeId": "rag.recipe:docs",
                    "stepId": "expand-relations",
                    "facts": { "kind": "rag.recipe.step", "stepId": "expand-relations", "typeNames": ["cites"] }
                }
            }
        ]
    }));

    append_builtin_lint_findings(&mut facts, &StaticIndexLintOptions::default());

    assert!(
        facts
            .lint_findings
            .iter()
            .all(|finding| finding.rule_id != "expand-relations-unknown-type")
    );
}

#[test]
fn recipe_producer_conflict_mirrors_runtime_diagnostic() {
    let mut facts = facts(json!({
        "definitions": [
            {
                "id": "rag.recipe:docs", "kind": "rag.recipe", "name": "docs",
                "fidelity": "resolved", "source": { "file": "src/knowledge.ts", "line": 5 }
            },
            {
                "id": "rag.recipe:docs:step:retrieve", "kind": "rag.recipe.step",
                "name": "retrieve", "fidelity": "resolved",
                "source": { "file": "src/knowledge.ts", "line": 7 },
                "metadata": { "recipeId": "rag.recipe:docs", "stepId": "retrieve", "index": 0 }
            },
            {
                "id": "rag.recipe:docs:step:globalSearch", "kind": "rag.recipe.step",
                "name": "globalSearch", "fidelity": "resolved",
                "source": { "file": "src/knowledge.ts", "line": 8 },
                "metadata": { "recipeId": "rag.recipe:docs", "stepId": "globalSearch", "index": 1 }
            }
        ]
    }));

    append_builtin_lint_findings(&mut facts, &StaticIndexLintOptions::default());

    let finding = facts
        .lint_findings
        .iter()
        .find(|finding| finding.rule_id == "knowledge-recipe-producer-conflict")
        .expect("producer conflict finding");
    assert_eq!(finding.severity, StaticIndexDiagnosticSeverity::Error);
    assert_eq!(
        finding.message,
        "Retrieval recipe has more than one producer step: \"retrieve\" and \"globalSearch\". Use exactly one of retrieve() or globalSearch()."
    );
    assert_eq!(finding.extra["primaryDefinitionId"], "rag.recipe:docs");
}

#[test]
fn single_recipe_producer_is_clean() {
    let mut facts = facts(json!({
        "definitions": [
            {
                "id": "rag.recipe:docs:step:retrieve", "kind": "rag.recipe.step",
                "name": "retrieve", "fidelity": "resolved",
                "metadata": { "recipeId": "rag.recipe:docs", "stepId": "retrieve", "index": 0 }
            },
            {
                "id": "rag.recipe:docs:step:expand-relations", "kind": "rag.recipe.step",
                "name": "expand-relations", "fidelity": "resolved",
                "metadata": { "recipeId": "rag.recipe:docs", "stepId": "expand-relations", "index": 1 }
            }
        ]
    }));

    append_builtin_lint_findings(&mut facts, &StaticIndexLintOptions::default());

    assert!(
        facts
            .lint_findings
            .iter()
            .all(|finding| finding.rule_id != "knowledge-recipe-producer-conflict")
    );
}

#[test]
fn assertion_selection_unknown_type_reports_declared_stage_types() {
    let mut facts = facts(json!({
        "definitions": [{
            "id": "knowledge.assertions:claims", "kind": "knowledge.assertions",
            "name": "claims", "fidelity": "resolved",
            "source": { "file": "src/knowledge.ts", "line": 3 },
            "metadata": { "facts": { "kind": "knowledge.assertions", "typeNames": ["risk", "owner"] } }
        }],
        "relations": [{
            "id": "relation:knowledge.assertions.selection:docs:claims",
            "type": "rag.knowledgeBase.uses_assertions",
            "from": "rag.knowledgeBase:docs",
            "to": "knowledge.assertions:claims",
            "fidelity": "resolved",
            "source": { "file": "src/knowledge.ts", "line": 10 },
            "metadata": { "selectedTypes": ["risk", "status"] }
        }]
    }));

    append_builtin_lint_findings(&mut facts, &StaticIndexLintOptions::default());

    let finding = facts
        .lint_findings
        .iter()
        .find(|finding| finding.rule_id == "assertions-unknown-type-selection")
        .expect("assertion selection finding");
    assert_eq!(finding.severity, StaticIndexDiagnosticSeverity::Warning);
    assert_eq!(
        finding.message,
        "Assertion selection for \"claims\" names unknown type \"status\"; declared assertion types: \"owner\", \"risk\"."
    );
    assert_eq!(
        finding.extra["source"],
        json!({ "file": "src/knowledge.ts", "line": 10 })
    );
}

#[test]
fn assertion_selection_declared_types_are_clean() {
    let mut facts = facts(json!({
        "definitions": [{
            "id": "knowledge.assertions:claims", "kind": "knowledge.assertions",
            "name": "claims", "fidelity": "resolved",
            "metadata": { "facts": { "kind": "knowledge.assertions", "typeNames": ["risk"] } }
        }],
        "relations": [{
            "id": "relation:knowledge.assertions.selection:docs:claims",
            "type": "rag.knowledgeBase.uses_assertions",
            "from": "rag.knowledgeBase:docs",
            "to": "knowledge.assertions:claims",
            "fidelity": "resolved",
            "metadata": { "selectedTypes": ["risk"] }
        }]
    }));

    append_builtin_lint_findings(&mut facts, &StaticIndexLintOptions::default());

    assert!(
        facts
            .lint_findings
            .iter()
            .all(|finding| finding.rule_id != "assertions-unknown-type-selection")
    );
}
