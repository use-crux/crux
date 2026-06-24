use std::fs;

use serde_json::json;

use crate::static_compiler::finalizer::run::{
    finalize_native_static_values_with_lint_facts, finalize_native_static_values_with_lint_options,
};
use crate::static_compiler::lint::filter::NativeStaticLintOptions;
use crate::static_compiler::relation::model::built_in_relation_policy_table;

#[test]
fn finalize_filters_extension_lint_findings_with_rule_descriptors() {
    let policies = built_in_relation_policy_table();
    let output = finalize_native_static_values_with_lint_options(
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
        &NativeStaticLintOptions {
            config: Some(json!({
                "rules": {
                    "@acme/rules/require-owner": { "enabled": false }
                }
            })),
            ..NativeStaticLintOptions::default()
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
    let output = finalize_native_static_values_with_lint_options(
        &[],
        &[],
        &policies,
        &NativeStaticLintOptions {
            config: Some(json!({
                "profile": "off",
                "rules": {
                    "@acme/rules/unknown": { "enabled": false }
                }
            })),
            ..NativeStaticLintOptions::default()
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
fn finalize_emits_quality_missing_baseline_from_quality_metadata() {
    let policies = built_in_relation_policy_table();
    let output = finalize_native_static_values_with_lint_options(
        &[],
        &[json!({
            "definitions": [{
                "id": "quality-target:writer",
                "kind": "quality.target",
                "name": "writer",
                "fidelity": "resolved",
                "quality": {
                    "experimentIds": ["experiment:writer"],
                    "experimentCount": 1,
                    "passRate": 0.8,
                    "lastRunId": "experiment:writer"
                }
            }]
        })],
        &policies,
        &NativeStaticLintOptions::default(),
    );

    assert!(
        output
            .model
            .facts
            .lint_findings
            .iter()
            .any(|finding| finding.rule_id == "quality.missing_baseline")
    );
}

#[test]
fn finalize_skips_quality_missing_baseline_when_baseline_exists() {
    let policies = built_in_relation_policy_table();
    let output = finalize_native_static_values_with_lint_options(
        &[],
        &[json!({
            "definitions": [{
                "id": "quality-target:writer",
                "kind": "quality.target",
                "name": "writer",
                "fidelity": "resolved",
                "quality": {
                    "experimentIds": ["experiment:writer"],
                    "baselineIds": ["baseline:writer"]
                }
            }]
        })],
        &policies,
        &NativeStaticLintOptions::default(),
    );

    assert!(
        output
            .model
            .facts
            .lint_findings
            .iter()
            .all(|finding| finding.rule_id != "quality.missing_baseline")
    );
}

#[test]
fn finalize_uses_lint_facts_without_materializing_lint_input_definitions() {
    let policies = built_in_relation_policy_table();
    let output = finalize_native_static_values_with_lint_facts(
        &[],
        &[],
        &[json!({
            "definitions": [{
                "id": "quality-target:writer",
                "kind": "quality.target",
                "name": "writer",
                "fidelity": "resolved",
                "quality": {
                    "experimentIds": ["experiment:writer"],
                    "experimentCount": 1
                }
            }]
        })],
        &policies,
        &NativeStaticLintOptions::default(),
    );

    assert_eq!(output.counts.definitions, 0);
    assert!(
        output
            .model
            .facts
            .lint_findings
            .iter()
            .any(|finding| finding.rule_id == "quality.missing_baseline")
    );
}

#[test]
fn finalize_suppresses_extension_lint_findings_with_rule_descriptors() {
    let policies = built_in_relation_policy_table();
    let file = std::env::temp_dir().join(format!(
        "crux-native-static-extension-suppression-{}-{}.ts",
        std::process::id(),
        line!()
    ));
    fs::write(
        &file,
        "// crux-lint-disable-next-line @acme/rules/require-owner -- covered by owner registry\nworkflow();\n",
    )
    .expect("write suppression fixture");
    let file = file.to_string_lossy().to_string();

    let output = finalize_native_static_values_with_lint_options(
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
                "source": { "file": file.clone(), "line": 2, "column": 1 },
                "evidence": []
            }]
        })],
        &policies,
        &NativeStaticLintOptions {
            files: vec![file.clone()],
            ..NativeStaticLintOptions::default()
        },
    );

    let _ = fs::remove_file(file);

    assert_eq!(output.counts.lint_findings, 0);
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
