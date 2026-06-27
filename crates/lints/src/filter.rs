//! Native lint config and suppression filtering.

use std::collections::BTreeSet;

use serde_json::Value;

use crate::facts::{
    StaticIndexDiagnostic, StaticIndexDiagnosticSeverity, StaticIndexLintFinding,
    StaticIndexRuleDescriptor, StaticIndexSourceLocation,
};
use crate::rules::filter::{finding_profiles, known_rule_ids};

#[derive(Debug, Clone)]
pub struct StaticIndexLintOptions {
    pub emit_builtin_lints: bool,
    pub config: Option<Value>,
    pub suppressions: Vec<StaticIndexLintSuppression>,
}

/// Prepared lint suppression directive found by the compiler host.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StaticIndexLintSuppression {
    pub file: String,
    pub line: usize,
    pub column: usize,
    pub scope: String,
    pub rule_id: String,
}

impl Default for StaticIndexLintOptions {
    fn default() -> Self {
        Self {
            emit_builtin_lints: true,
            config: None,
            suppressions: Vec::new(),
        }
    }
}

pub(crate) fn apply_lint_filters(
    findings: Vec<StaticIndexLintFinding>,
    diagnostics: &mut Vec<StaticIndexDiagnostic>,
    options: &StaticIndexLintOptions,
    rule_descriptors: &[StaticIndexRuleDescriptor],
) -> Vec<StaticIndexLintFinding> {
    let known = known_rule_ids(rule_descriptors);
    let suppressed = apply_suppressions(findings, diagnostics, &options.suppressions, &known);
    apply_config(suppressed, diagnostics, options.config.as_ref(), &known)
}

fn apply_config(
    findings: Vec<StaticIndexLintFinding>,
    diagnostics: &mut Vec<StaticIndexDiagnostic>,
    config: Option<&Value>,
    known: &BTreeSet<String>,
) -> Vec<StaticIndexLintFinding> {
    let profile = config
        .and_then(|config| config.get("profile"))
        .and_then(Value::as_str)
        .unwrap_or("recommended");
    let rules = config
        .and_then(|config| config.get("rules"))
        .and_then(Value::as_object);
    let disabled = rules
        .into_iter()
        .flatten()
        .filter_map(|(rule_id, rule_config)| {
            if !known.contains(rule_id) {
                diagnostics.push(unknown_configured_rule_diagnostic(rule_id));
                return None;
            }
            (rule_config.get("enabled").and_then(Value::as_bool) == Some(false))
                .then(|| rule_id.clone())
        })
        .collect::<BTreeSet<_>>();
    if profile == "off" {
        return Vec::new();
    }

    findings
        .into_iter()
        .filter(|finding| !disabled.contains(&finding.rule_id))
        .filter_map(|mut finding| {
            if let Some(severity) = rules
                .and_then(|rules| rules.get(&finding.rule_id))
                .and_then(|rule| rule.get("severity"))
                .and_then(Value::as_str)
                .and_then(parse_severity)
            {
                finding.severity = severity;
            }
            let profiles = finding_profiles(&finding);
            (profiles.is_empty() || profiles.contains(&profile.to_string())).then_some(finding)
        })
        .collect()
}

fn apply_suppressions(
    findings: Vec<StaticIndexLintFinding>,
    diagnostics: &mut Vec<StaticIndexDiagnostic>,
    suppressions: &[StaticIndexLintSuppression],
    known: &BTreeSet<String>,
) -> Vec<StaticIndexLintFinding> {
    let mut suppressions = suppressions
        .iter()
        .map(LintSuppression::from)
        .collect::<Vec<_>>();
    for suppression in &suppressions {
        if !known.contains(&suppression.rule_id) {
            diagnostics.push(unknown_suppression_rule_diagnostic(suppression));
        }
    }
    let mut kept = Vec::new();
    for finding in findings {
        let matched = suppressions.iter_mut().find(|suppression| {
            known.contains(&suppression.rule_id) && suppresses(suppression, &finding)
        });
        if let Some(suppression) = matched {
            suppression.used = true;
        } else {
            kept.push(finding);
        }
    }
    for suppression in suppressions {
        if known.contains(&suppression.rule_id) && !suppression.used {
            diagnostics.push(unused_suppression_diagnostic(&suppression));
        }
    }
    kept
}

#[derive(Debug, Clone)]
struct LintSuppression {
    id: String,
    file: String,
    line: usize,
    column: usize,
    scope: String,
    rule_id: String,
    used: bool,
}

impl From<&StaticIndexLintSuppression> for LintSuppression {
    fn from(input: &StaticIndexLintSuppression) -> Self {
        Self {
            id: format!(
                "{}:{}:{}:{}",
                input.file, input.line, input.scope, input.rule_id
            ),
            file: input.file.clone(),
            line: input.line,
            column: input.column,
            scope: input.scope.clone(),
            rule_id: input.rule_id.clone(),
            used: false,
        }
    }
}

fn suppresses(suppression: &LintSuppression, finding: &StaticIndexLintFinding) -> bool {
    if finding.rule_id != suppression.rule_id {
        return false;
    }
    let Some(source) = finding_source(finding) else {
        return false;
    };
    if source.file != suppression.file {
        return false;
    }
    match suppression.scope.as_str() {
        "file" => true,
        "line" => source.line == suppression.line,
        "next-line" => source.line == suppression.line + 1,
        _ => false,
    }
}

fn finding_source(finding: &StaticIndexLintFinding) -> Option<StaticIndexSourceLocation> {
    serde_json::from_value(finding.extra.get("source")?.clone()).ok()
}

fn parse_severity(value: &str) -> Option<StaticIndexDiagnosticSeverity> {
    match value {
        "info" => Some(StaticIndexDiagnosticSeverity::Info),
        "warning" => Some(StaticIndexDiagnosticSeverity::Warning),
        "error" => Some(StaticIndexDiagnosticSeverity::Error),
        _ => None,
    }
}

fn unknown_configured_rule_diagnostic(rule_id: &str) -> StaticIndexDiagnostic {
    StaticIndexDiagnostic {
        id: format!("index.lint_unknown_configured_rule:{rule_id}"),
        severity: StaticIndexDiagnosticSeverity::Warning,
        code: "index.lint_unknown_configured_rule".to_string(),
        message: format!("Crux lint config references unknown rule \"{rule_id}\"."),
        source: None,
        related_definition_ids: Vec::new(),
        suggested_fix: Some(
            "Remove the rule override or update it to a known Crux lint rule id.".to_string(),
        ),
    }
}

fn unknown_suppression_rule_diagnostic(suppression: &LintSuppression) -> StaticIndexDiagnostic {
    suppression_diagnostic(
        "index.lint_unknown_suppression_rule",
        &format!(
            "Unknown Crux lint rule \"{}\" in suppression comment.",
            suppression.rule_id
        ),
        "Use a known Crux lint rule id or remove the suppression comment.",
        suppression,
        StaticIndexDiagnosticSeverity::Warning,
    )
}

fn unused_suppression_diagnostic(suppression: &LintSuppression) -> StaticIndexDiagnostic {
    suppression_diagnostic(
        "index.lint_unused_suppression",
        &format!(
            "Crux lint suppression for \"{}\" did not match any finding.",
            suppression.rule_id
        ),
        "Remove the stale suppression or move it to the finding it is intended to suppress.",
        suppression,
        StaticIndexDiagnosticSeverity::Info,
    )
}

fn suppression_diagnostic(
    code: &str,
    message: &str,
    fix: &str,
    suppression: &LintSuppression,
    severity: StaticIndexDiagnosticSeverity,
) -> StaticIndexDiagnostic {
    StaticIndexDiagnostic {
        id: format!("{code}:{}", sanitize_key(&suppression.id)),
        severity,
        code: code.to_string(),
        message: message.to_string(),
        source: Some(StaticIndexSourceLocation {
            file: suppression.file.clone(),
            line: suppression.line,
            column: Some(suppression.column),
            function_name: None,
        }),
        related_definition_ids: Vec::new(),
        suggested_fix: Some(fix.to_string()),
    }
}

fn sanitize_key(value: &str) -> String {
    value
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() || matches!(character, '_' | '.' | ':' | '-') {
                character
            } else {
                '-'
            }
        })
        .collect()
}
