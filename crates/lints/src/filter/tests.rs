use std::collections::BTreeMap;

use serde_json::{Value, json};

use super::*;
use crate::facts::{
    StaticIndexLintSuppressedBy, StaticIndexLintSuppressionScope as FactScope,
    StaticIndexSourceLocation,
};

const RULE_ID: &str = "@acme/rules/require-owner";

fn descriptor() -> StaticIndexRuleDescriptor {
    serde_json::from_value(json!({
        "id": RULE_ID,
        "source": "extension",
        "title": "Require owner",
        "description": "Requires an owner."
    }))
    .expect("rule descriptor")
}

fn finding(id: &str, line: Option<usize>) -> StaticIndexLintFinding {
    let mut extra = BTreeMap::new();
    if let Some(line) = line {
        extra.insert(
            "source".to_string(),
            json!({ "file": "src/workflow.ts", "line": line, "column": 2 }),
        );
    }
    StaticIndexLintFinding {
        id: id.to_string(),
        severity: StaticIndexDiagnosticSeverity::Warning,
        rule_id: RULE_ID.to_string(),
        title: "Require owner".to_string(),
        message: "Workflow is missing an owner.".to_string(),
        suppressed: false,
        suppressed_by: None,
        extra,
    }
}

fn directive(line: usize, scope: StaticIndexLintSuppressionScope) -> StaticIndexLintSuppression {
    StaticIndexLintSuppression {
        file: "src/workflow.ts".to_string(),
        line,
        column: 4,
        scope,
        rule_id: RULE_ID.to_string(),
        reason: Some(format!("reason at {line}")),
    }
}

fn filter(
    findings: Vec<StaticIndexLintFinding>,
    suppressions: Vec<StaticIndexLintSuppression>,
    config: Option<Value>,
) -> (Vec<StaticIndexLintFinding>, Vec<StaticIndexDiagnostic>) {
    let mut diagnostics = Vec::new();
    let findings = apply_lint_filters(
        findings,
        &mut diagnostics,
        &StaticIndexLintOptions {
            suppressions,
            config,
            ..StaticIndexLintOptions::default()
        },
        &[descriptor()],
    );
    (findings, diagnostics)
}

#[test]
fn one_directive_annotates_every_matching_finding() {
    let (findings, diagnostics) = filter(
        vec![finding("one", Some(2)), finding("two", Some(2))],
        vec![directive(1, StaticIndexLintSuppressionScope::NextLine)],
        None,
    );

    assert_eq!(findings.len(), 2);
    assert!(findings.iter().all(|finding| finding.suppressed));
    assert!(
        diagnostics
            .iter()
            .all(|diagnostic| diagnostic.code != "index.lint_unused_suppression")
    );
}

#[test]
fn first_matching_directive_owns_metadata() {
    let (findings, diagnostics) = filter(
        vec![finding("one", Some(2))],
        vec![
            directive(1, StaticIndexLintSuppressionScope::NextLine),
            directive(2, StaticIndexLintSuppressionScope::Line),
        ],
        None,
    );

    let suppressed_by = findings[0]
        .suppressed_by
        .as_ref()
        .expect("suppression metadata");
    assert_eq!(suppressed_by.scope, FactScope::NextLine);
    assert_eq!(suppressed_by.source.line, 1);
    assert_eq!(suppressed_by.reason.as_deref(), Some("reason at 1"));
    assert_eq!(
        diagnostics
            .iter()
            .filter(|diagnostic| diagnostic.code == "index.lint_unused_suppression")
            .count(),
        1
    );
}

#[test]
fn source_less_finding_cannot_match_a_directive() {
    let (findings, diagnostics) = filter(
        vec![finding("one", None)],
        vec![directive(1, StaticIndexLintSuppressionScope::File)],
        None,
    );

    assert!(!findings[0].suppressed);
    assert_eq!(
        diagnostics
            .iter()
            .filter(|diagnostic| diagnostic.code == "index.lint_unused_suppression")
            .count(),
        1
    );
}

#[test]
fn unknown_rule_directive_reports_unknown_without_suppressing() {
    let mut unknown = directive(1, StaticIndexLintSuppressionScope::NextLine);
    unknown.rule_id = "@acme/rules/unknown".to_string();

    let (findings, diagnostics) = filter(vec![finding("one", Some(2))], vec![unknown], None);

    assert!(!findings[0].suppressed);
    assert_eq!(
        diagnostics
            .iter()
            .filter(|diagnostic| diagnostic.code == "index.lint_unknown_suppression_rule")
            .count(),
        1
    );
    assert!(
        diagnostics
            .iter()
            .all(|diagnostic| diagnostic.code != "index.lint_unused_suppression")
    );
}

#[test]
fn known_unmatched_directive_reports_unused() {
    let (findings, diagnostics) = filter(
        vec![finding("one", Some(2))],
        vec![directive(8, StaticIndexLintSuppressionScope::NextLine)],
        None,
    );

    assert!(!findings[0].suppressed);
    assert_eq!(
        diagnostics
            .iter()
            .filter(|diagnostic| diagnostic.code == "index.lint_unused_suppression")
            .count(),
        1
    );
}

#[test]
fn line_next_line_and_file_scopes_have_exact_boundaries() {
    let cases = [
        (StaticIndexLintSuppressionScope::Line, 3, 3, true),
        (StaticIndexLintSuppressionScope::Line, 3, 4, false),
        (StaticIndexLintSuppressionScope::NextLine, 3, 4, true),
        (StaticIndexLintSuppressionScope::NextLine, 3, 3, false),
        (StaticIndexLintSuppressionScope::File, 3, 40, true),
    ];

    for (scope, directive_line, finding_line, expected) in cases {
        let (findings, _) = filter(
            vec![finding("one", Some(finding_line))],
            vec![directive(directive_line, scope)],
            None,
        );
        assert_eq!(findings[0].suppressed, expected, "scope {scope:?}");
    }
}

#[test]
fn matching_precedes_rule_disabling_and_marks_directive_used() {
    let (findings, diagnostics) = filter(
        vec![finding("one", Some(2))],
        vec![directive(1, StaticIndexLintSuppressionScope::NextLine)],
        Some(json!({ "rules": { "@acme/rules/require-owner": { "enabled": false } } })),
    );

    assert!(findings.is_empty());
    assert!(
        diagnostics
            .iter()
            .all(|diagnostic| diagnostic.code != "index.lint_unused_suppression")
    );
}

#[test]
fn severity_override_applies_to_retained_suppressed_finding() {
    let (findings, _) = filter(
        vec![finding("one", Some(2))],
        vec![directive(1, StaticIndexLintSuppressionScope::NextLine)],
        Some(json!({ "rules": { "@acme/rules/require-owner": { "severity": "error" } } })),
    );

    assert_eq!(findings.len(), 1);
    assert!(findings[0].suppressed);
    assert_eq!(findings[0].severity, StaticIndexDiagnosticSeverity::Error);
}

#[test]
fn incoming_suppression_state_is_cleared_without_a_matching_directive() {
    let mut premarked = finding("one", Some(2));
    premarked.suppressed = true;
    premarked.suppressed_by = Some(StaticIndexLintSuppressedBy {
        source: StaticIndexSourceLocation {
            file: "extension.ts".to_string(),
            line: 1,
            column: None,
            function_name: None,
        },
        scope: FactScope::File,
        reason: Some("extension-authored".to_string()),
    });

    let (findings, _) = filter(vec![premarked], Vec::new(), None);

    assert!(!findings[0].suppressed);
    assert_eq!(findings[0].suppressed_by, None);
}
