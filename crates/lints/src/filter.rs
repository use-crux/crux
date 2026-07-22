//! Native lint config and suppression filtering.

use std::collections::BTreeSet;

use serde_json::Value;

use crate::facts::{
    StaticIndexDiagnostic, StaticIndexDiagnosticSeverity, StaticIndexLintFinding,
    StaticIndexRuleDescriptor,
};
use crate::rules::filter::{finding_profiles, known_rule_ids};
use crate::suppression::annotate_suppressions;

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
    pub scope: StaticIndexLintSuppressionScope,
    pub rule_id: String,
    pub reason: Option<String>,
}

#[derive(Debug, Copy, Clone, PartialEq, Eq)]
pub enum StaticIndexLintSuppressionScope {
    NextLine,
    Line,
    File,
}

impl StaticIndexLintSuppressionScope {
    pub(crate) fn as_str(self) -> &'static str {
        match self {
            Self::NextLine => "next-line",
            Self::Line => "line",
            Self::File => "file",
        }
    }
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
    let suppressed = annotate_suppressions(findings, diagnostics, &options.suppressions, &known);
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

#[cfg(test)]
mod tests;
