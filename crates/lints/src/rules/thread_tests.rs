use serde_json::{Value, json};

use crate::facts::{StaticIndexDiagnosticSeverity, StaticIndexPatchFacts};
use crate::filter::{
    StaticIndexLintOptions, StaticIndexLintSuppression, StaticIndexLintSuppressionScope,
};
use crate::findings::append_builtin_lint_findings;

fn facts(value: Value) -> StaticIndexPatchFacts {
    serde_json::from_value(value).expect("fixture facts decode")
}

#[test]
fn duplicate_active_threads_emit_a_first_class_finding() {
    let mut facts = facts(json!({
        "definitions": [{
            "id": "thread:conversation", "kind": "thread", "name": "conversation",
            "fidelity": "resolved", "status": "active",
            "source": { "file": "src/a.ts", "line": 3 },
            "sourceRefs": [
                {
                    "id": "source-ref:thread-definition:thread:conversation:first",
                    "role": "definition", "symbol": "conversation",
                    "source": { "file": "src/a.ts", "line": 3 }, "fidelity": "resolved"
                },
                {
                    "id": "source-ref:thread-definition:thread:conversation:second",
                    "role": "definition", "symbol": "duplicateConversation",
                    "source": { "file": "src/b.ts", "line": 7 }, "fidelity": "resolved"
                }
            ]
        }]
    }));

    append_builtin_lint_findings(&mut facts, &StaticIndexLintOptions::default());

    let finding = facts
        .lint_findings
        .iter()
        .find(|finding| finding.rule_id == "thread.duplicate_active")
        .expect("duplicate Thread lint finding");
    assert_eq!(finding.severity, StaticIndexDiagnosticSeverity::Error);
    assert_eq!(
        finding.message,
        "Thread definition \"thread:conversation\" is active in 2 source locations."
    );
    assert_eq!(
        finding.extra.get("source"),
        Some(&json!({ "file": "src/a.ts", "line": 3 }))
    );
    assert_eq!(
        finding.extra.get("relatedDefinitionIds"),
        Some(&json!(["thread:conversation"]))
    );
    assert!(finding.extra["fixes"].as_array().is_some_and(|fixes| {
        fixes
            .iter()
            .any(|fix| fix["title"] == "Give each active Thread a unique id")
    }));
}

#[test]
fn one_authored_thread_location_and_regular_definition_refs_are_not_duplicates() {
    let mut facts = facts(json!({
        "definitions": [
            {
                "id": "thread:conversation", "kind": "thread", "name": "conversation",
                "fidelity": "resolved", "status": "active",
                "source": { "file": "src/thread.ts", "line": 3 },
                "sourceRefs": [{
                    "id": "extension:thread:definition:helper", "role": "definition",
                    "symbol": "threadFactory",
                    "source": { "file": "src/helper.ts", "line": 1 }, "fidelity": "resolved"
                }]
            },
            {
                "id": "thread:conversation", "kind": "thread", "name": "conversation",
                "fidelity": "resolved", "status": "active",
                "source": { "file": "src/thread.ts", "line": 3 }
            }
        ]
    }));

    append_builtin_lint_findings(&mut facts, &StaticIndexLintOptions::default());

    assert!(
        facts
            .lint_findings
            .iter()
            .all(|finding| { finding.rule_id != "thread.duplicate_active" })
    );
}

#[test]
fn duplicate_thread_next_line_suppression_matches_the_reported_definition() {
    let mut facts = facts(json!({
        "definitions": [
            {
                "id": "thread:conversation", "kind": "thread", "name": "conversation",
                "fidelity": "resolved", "status": "active",
                "source": { "file": "src/thread.ts", "line": 3 }
            },
            {
                "id": "thread:conversation", "kind": "thread", "name": "conversation",
                "fidelity": "resolved", "status": "active",
                "source": { "file": "src/thread.ts", "line": 7 }
            }
        ]
    }));
    let options = StaticIndexLintOptions {
        suppressions: vec![StaticIndexLintSuppression {
            file: "src/thread.ts".to_string(),
            line: 2,
            column: 0,
            scope: StaticIndexLintSuppressionScope::NextLine,
            rule_id: "thread.duplicate_active".to_string(),
            reason: Some("migration".to_string()),
        }],
        ..StaticIndexLintOptions::default()
    };

    append_builtin_lint_findings(&mut facts, &options);

    let finding = facts
        .lint_findings
        .iter()
        .find(|finding| finding.rule_id == "thread.duplicate_active")
        .expect("duplicate Thread finding");
    assert!(finding.suppressed);
    assert!(
        facts
            .diagnostics
            .iter()
            .all(|diagnostic| { diagnostic.code != "index.lint_unused_suppression" })
    );
}

#[test]
fn multiple_thread_bindings_emit_a_first_class_finding() {
    let mut facts = facts(json!({
        "definitions": [
            {
                "id": "prompt:writer", "kind": "prompt", "name": "writer",
                "fidelity": "resolved", "status": "active",
                "source": { "file": "src/prompt.ts", "line": 10 }
            },
            {
                "id": "thread:first", "kind": "thread", "name": "first",
                "fidelity": "resolved", "status": "active"
            },
            {
                "id": "thread:second", "kind": "thread", "name": "second",
                "fidelity": "resolved", "status": "active"
            }
        ],
        "relations": [
            {
                "id": "relation:prompt.uses_thread:prompt:writer:thread:first",
                "type": "prompt.uses_thread", "from": "prompt:writer", "to": "thread:first",
                "fidelity": "resolved"
            },
            {
                "id": "relation:prompt.uses_thread:prompt:writer:thread:second",
                "type": "prompt.uses_thread", "from": "prompt:writer", "to": "thread:second",
                "fidelity": "resolved"
            }
        ]
    }));

    append_builtin_lint_findings(&mut facts, &StaticIndexLintOptions::default());

    let finding = facts
        .lint_findings
        .iter()
        .find(|finding| finding.rule_id == "thread.conflicting_binding")
        .expect("conflicting Thread binding lint finding");
    assert_eq!(finding.severity, StaticIndexDiagnosticSeverity::Error);
    assert_eq!(
        finding.message,
        "Definition \"prompt:writer\" resolves 2 Thread bindings."
    );
    assert_eq!(
        finding.extra.get("relatedDefinitionIds"),
        Some(&json!(["prompt:writer", "thread:first", "thread:second"]))
    );
    assert!(finding.extra["fixes"].as_array().is_some_and(|fixes| {
        fixes
            .iter()
            .any(|fix| fix["title"] == "Keep one Thread binding")
    }));
}

#[test]
fn prompt_and_context_thread_relations_resolve_injection_entries() {
    let owner = |id: &str, kind: &str| {
        json!({
            "id": id, "kind": kind, "name": id, "fidelity": "resolved", "status": "active",
            "metadata": { "facts": { "useEntries": [{ "variable": "conversation" }] } }
        })
    };
    let mut facts = facts(json!({
        "definitions": [
            owner("prompt:writer", "prompt"),
            owner("context:writer-context", "context"),
            {
                "id": "thread:conversation", "kind": "thread", "name": "conversation",
                "fidelity": "resolved", "status": "active",
                "metadata": { "exportName": "duplicateConversation" },
                "sourceRefs": [{
                    "id": "source-ref:thread-definition:thread:conversation:conversation",
                    "role": "definition", "symbol": "conversation",
                    "source": { "file": "src/thread.ts", "line": 2 }, "fidelity": "resolved"
                }]
            }
        ],
        "relations": [
            {
                "id": "relation:prompt.uses_thread:prompt:writer:thread:conversation",
                "type": "prompt.uses_thread", "from": "prompt:writer", "to": "thread:conversation",
                "fidelity": "resolved"
            },
            {
                "id": "relation:context.uses_thread:context:writer-context:thread:conversation",
                "type": "context.uses_thread", "from": "context:writer-context", "to": "thread:conversation",
                "fidelity": "resolved"
            }
        ]
    }));

    append_builtin_lint_findings(&mut facts, &StaticIndexLintOptions::default());

    for owner in ["prompt:writer", "context:writer-context"] {
        assert!(facts.lint_findings.iter().all(|finding| {
            finding.rule_id != "injection.unresolved_target"
                || finding.extra["primaryDefinitionId"] != owner
        }));
    }
}
