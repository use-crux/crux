use serde_json::json;

use crate::finalizer::run::{
    finalize_static_index_values_with_lint_facts, finalize_static_index_values_with_lint_options,
};
use crate::lints::filter::{
    StaticIndexLintOptions, StaticIndexLintSuppression, StaticIndexLintSuppressionScope,
};
use crate::relation::model::built_in_relation_policy_table;

#[test]
fn finalize_filters_extension_lint_findings_with_rule_descriptors() {
    let policies = built_in_relation_policy_table();
    let output = finalize_static_index_values_with_lint_options(
        &[],
        &[json!({
            "ruleDescriptors": [{
                "id": "@acme/rules/require-owner",
                "source": "extension",
                "title": "Require owner",
                "description": "Requires an owner."
            }],
            "lintFindings": [{
                "id": "rule:owner:workflow",
                "ruleId": "@acme/rules/require-owner",
                "severity": "warning",
                "title": "Require owner",
                "message": "Workflow is missing an owner.",
                "evidence": []
            }]
        })],
        &policies,
        &StaticIndexLintOptions {
            config: Some(json!({
                "rules": {
                    "@acme/rules/require-owner": { "enabled": false }
                }
            })),
            ..StaticIndexLintOptions::default()
        },
    );

    assert_eq!(output.counts.lint_findings, 0);
    assert!(
        output
            .model
            .facts
            .rule_descriptors
            .iter()
            .any(|descriptor| descriptor.id == "@acme/rules/require-owner")
    );
}

#[test]
fn finalize_validates_lint_config_when_profile_is_off() {
    let policies = built_in_relation_policy_table();
    let output = finalize_static_index_values_with_lint_options(
        &[],
        &[],
        &policies,
        &StaticIndexLintOptions {
            config: Some(json!({
                "profile": "off",
                "rules": {
                    "@acme/rules/unknown": { "enabled": false }
                }
            })),
            ..StaticIndexLintOptions::default()
        },
    );

    assert_eq!(output.counts.lint_findings, 0);
    assert!(
        output
            .model
            .facts
            .diagnostics
            .iter()
            .any(|diagnostic| diagnostic.code == "index.lint_unknown_configured_rule")
    );
}

#[test]
fn finalize_uses_lint_facts_without_materializing_lint_input_definitions() {
    let policies = built_in_relation_policy_table();
    let output = finalize_static_index_values_with_lint_facts(
        &[],
        &[],
        &[json!({
            "definitions": [{
                "id": "eval:writer",
                "kind": "eval",
                "name": "writer",
                "fidelity": "resolved"
            }],
            "lintFindings": [{
                "id": "lint:writer",
                "ruleId": "definition.missing_eval_coverage",
                "severity": "info",
                "title": "Definition has no eval coverage",
                "message": "writer is not covered",
                "evidence": []
            }]
        })],
        &policies,
        &StaticIndexLintOptions::default(),
    );

    assert_eq!(output.counts.definitions, 0);
    assert!(
        output
            .model
            .facts
            .lint_findings
            .iter()
            .any(|finding| finding.rule_id == "definition.missing_eval_coverage")
    );
}

#[test]
fn finalize_suppresses_extension_lint_findings_with_rule_descriptors() {
    let policies = built_in_relation_policy_table();
    let file = "/repo/src/workflow.ts";

    let output = finalize_static_index_values_with_lint_options(
        &[],
        &[json!({
            "ruleDescriptors": [{
                "id": "@acme/rules/require-owner",
                "source": "extension",
                "title": "Require owner",
                "description": "Requires an owner."
            }],
            "lintFindings": [{
                "id": "rule:owner:workflow",
                "ruleId": "@acme/rules/require-owner",
                "severity": "warning",
                "title": "Require owner",
                "message": "Workflow is missing an owner.",
                "source": { "file": file, "line": 2, "column": 1 },
                "evidence": []
            }]
        })],
        &policies,
        &StaticIndexLintOptions {
            suppressions: vec![StaticIndexLintSuppression {
                file: file.to_string(),
                line: 1,
                column: 4,
                scope: StaticIndexLintSuppressionScope::NextLine,
                rule_id: "@acme/rules/require-owner".to_string(),
                reason: Some("intentional reason".to_string()),
            }],
            ..StaticIndexLintOptions::default()
        },
    );

    assert_eq!(output.counts.lint_findings, 1);
    let finding = &output.model.facts.lint_findings[0];
    assert!(finding.suppressed);
    let suppressed_by = finding
        .suppressed_by
        .as_ref()
        .expect("matched finding has suppression metadata");
    assert_eq!(suppressed_by.source.file, file);
    assert_eq!(suppressed_by.source.line, 1);
    assert_eq!(suppressed_by.source.column, Some(4));
    assert_eq!(
        suppressed_by.scope,
        crux_indexer_facts::StaticIndexLintSuppressionScope::NextLine
    );
    assert_eq!(suppressed_by.reason.as_deref(), Some("intentional reason"));
    assert!(
        output
            .model
            .facts
            .diagnostics
            .iter()
            .all(|diagnostic| !matches!(
                diagnostic.code.as_str(),
                "index.lint_unknown_suppression_rule" | "index.lint_unused_suppression"
            ))
    );
}
