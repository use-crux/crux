use serde_json::{Value, json};

use crate::facts::{StaticIndexDiagnosticSeverity, StaticIndexPatchFacts};
use crate::filter::StaticIndexLintOptions;
use crate::findings::append_builtin_lint_findings;

fn facts(value: Value) -> StaticIndexPatchFacts {
    serde_json::from_value(value).expect("fixture facts decode")
}

#[test]
fn unstable_session_identity_reports_exact_source_and_evidence() {
    let mut facts = facts(json!({
        "definitions": [{
            "id": "session:src-sessions.ts:4:24",
            "kind": "session",
            "name": "support",
            "fidelity": "partial",
            "status": "active",
            "source": { "file": "src/sessions.ts", "line": 4, "column": 24 },
            "metadata": { "facts": {
                "kind": "session",
                "operation": "create",
                "targetVariable": "supportAgent",
                "targetDefinitionId": "agent:support",
                "key": { "kind": "dynamic" },
                "identity": "partial"
            }}
        }]
    }));

    append_builtin_lint_findings(&mut facts, &StaticIndexLintOptions::default());

    let finding = facts
        .lint_findings
        .iter()
        .find(|finding| finding.rule_id == "session.unstable_identity")
        .expect("unstable Session identity finding");
    assert_eq!(finding.severity, StaticIndexDiagnosticSeverity::Error);
    assert_eq!(
        finding.extra.get("source"),
        Some(&json!({ "file": "src/sessions.ts", "line": 4, "column": 24 }))
    );
    assert_eq!(
        finding.extra["evidence"][0]["data"],
        json!({
            "identity": "partial",
            "key": { "kind": "dynamic" },
            "operation": "create",
            "targetDefinitionId": "agent:support"
        })
    );
}

#[test]
fn dynamic_session_target_reports_exact_form_and_source() {
    let mut facts = facts(json!({
        "definitions": [{
            "id": "session:src-sessions.ts:8:20",
            "kind": "session",
            "name": "selected",
            "fidelity": "partial",
            "status": "active",
            "source": { "file": "src/sessions.ts", "line": 8, "column": 20 },
            "metadata": { "facts": {
                "kind": "session",
                "operation": "create",
                "targetVariable": "selectAgent()",
                "target": { "kind": "dynamic" },
                "key": { "kind": "literal", "value": "customer-a" },
                "identity": "partial"
            }}
        }]
    }));

    append_builtin_lint_findings(&mut facts, &StaticIndexLintOptions::default());

    let finding = facts
        .lint_findings
        .iter()
        .find(|finding| finding.rule_id == "session.invalid_target")
        .expect("invalid Session target finding");
    assert_eq!(finding.severity, StaticIndexDiagnosticSeverity::Error);
    assert_eq!(
        finding.extra.get("source"),
        Some(&json!({ "file": "src/sessions.ts", "line": 8, "column": 20 }))
    );
    assert_eq!(
        finding.extra["evidence"][0]["data"],
        json!({
            "operation": "create",
            "target": { "kind": "dynamic" },
            "targetVariable": "selectAgent()"
        })
    );
    assert!(
        facts
            .lint_findings
            .iter()
            .all(|finding| finding.rule_id != "session.unstable_identity"),
        "a stable literal key should not duplicate the target diagnostic"
    );
}

#[test]
fn ambiguous_session_construction_reports_call_shape() {
    let mut facts = facts(json!({
        "definitions": [{
            "id": "session:src-sessions.ts:12:18",
            "kind": "session",
            "name": "ambiguous",
            "fidelity": "partial",
            "status": "active",
            "source": { "file": "src/sessions.ts", "line": 12, "column": 18 },
            "metadata": { "facts": {
                "kind": "session",
                "operation": "create",
                "targetVariable": "supportAgent",
                "targetDefinitionId": "agent:support",
                "target": { "kind": "agent" },
                "key": { "kind": "dynamic" },
                "identity": "partial",
                "call": { "kind": "ambiguous", "reason": "options" }
            }}
        }]
    }));

    append_builtin_lint_findings(&mut facts, &StaticIndexLintOptions::default());

    let finding = facts
        .lint_findings
        .iter()
        .find(|finding| finding.rule_id == "session.ambiguous_construction")
        .expect("ambiguous Session construction finding");
    assert_eq!(finding.severity, StaticIndexDiagnosticSeverity::Error);
    assert_eq!(
        finding.extra["evidence"][0]["data"],
        json!({
            "call": { "kind": "ambiguous", "reason": "options" },
            "operation": "create"
        })
    );
}

#[test]
fn concrete_agent_thread_tenancy_reports_both_graph_edges() {
    let mut facts = facts(json!({
        "definitions": [
            {
                "id": "session:support:customer-a", "kind": "session",
                "name": "support:customer-a", "fidelity": "resolved", "status": "active",
                "source": { "file": "src/sessions.ts", "line": 6, "column": 24 },
                "metadata": { "facts": {
                    "kind": "session", "operation": "create",
                    "targetDefinitionId": "agent:support", "target": { "kind": "agent" },
                    "key": { "kind": "literal", "value": "customer-a" }, "identity": "static",
                    "call": { "kind": "supported" }
                }}
            },
            { "id": "agent:support", "kind": "agent", "name": "support", "fidelity": "resolved" },
            { "id": "thread:shared", "kind": "thread", "name": "shared", "fidelity": "resolved" }
        ],
        "relations": [
            {
                "id": "relation:session.targets_agent:session:support:customer-a:agent:support",
                "type": "session.targets_agent", "from": "session:support:customer-a", "to": "agent:support",
                "fidelity": "resolved", "source": { "file": "src/sessions.ts", "line": 6, "column": 32 }
            },
            {
                "id": "relation:agent.uses_thread:agent:support:thread:shared",
                "type": "agent.uses_thread", "from": "agent:support", "to": "thread:shared",
                "fidelity": "resolved", "source": { "file": "src/agent.ts", "line": 9, "column": 8 }
            }
        ]
    }));

    append_builtin_lint_findings(&mut facts, &StaticIndexLintOptions::default());

    let finding = facts
        .lint_findings
        .iter()
        .find(|finding| finding.rule_id == "session.shared_agent_thread")
        .expect("shared concrete-Agent Thread finding");
    assert_eq!(finding.severity, StaticIndexDiagnosticSeverity::Warning);
    assert_eq!(
        finding.extra.get("source"),
        Some(&json!({ "file": "src/sessions.ts", "line": 6, "column": 24 }))
    );
    assert_eq!(finding.extra["evidence"].as_array().map(Vec::len), Some(2));
    assert_eq!(
        finding.extra["relatedDefinitionIds"],
        json!([
            "session:support:customer-a",
            "agent:support",
            "thread:shared"
        ])
    );
}
