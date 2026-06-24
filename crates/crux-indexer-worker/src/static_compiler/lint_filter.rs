//! Native lint config and suppression filtering.

use std::collections::BTreeSet;
use std::fs;

use serde_json::Value;

use crate::static_compiler::facts::{
    NativeStaticDiagnostic, NativeStaticDiagnosticSeverity, NativeStaticLintFinding,
    NativeStaticRuleDescriptor, NativeStaticSourceLocation,
};
use crate::static_compiler::lint_filter_rules::{finding_profiles, known_rule_ids};

#[derive(Debug, Clone)]
pub(crate) struct NativeStaticLintOptions {
    pub(crate) emit_builtin_lints: bool,
    pub(crate) config: Option<Value>,
    pub(crate) files: Vec<String>,
}

impl Default for NativeStaticLintOptions {
    fn default() -> Self {
        Self {
            emit_builtin_lints: true,
            config: None,
            files: Vec::new(),
        }
    }
}

pub(crate) fn apply_lint_filters(
    findings: Vec<NativeStaticLintFinding>,
    diagnostics: &mut Vec<NativeStaticDiagnostic>,
    options: &NativeStaticLintOptions,
    rule_descriptors: &[NativeStaticRuleDescriptor],
) -> Vec<NativeStaticLintFinding> {
    let known = known_rule_ids(rule_descriptors);
    let suppressed = apply_suppressions(findings, diagnostics, &options.files, &known);
    apply_config(suppressed, diagnostics, options.config.as_ref(), &known)
}

fn apply_config(
    findings: Vec<NativeStaticLintFinding>,
    diagnostics: &mut Vec<NativeStaticDiagnostic>,
    config: Option<&Value>,
    known: &BTreeSet<String>,
) -> Vec<NativeStaticLintFinding> {
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
    findings: Vec<NativeStaticLintFinding>,
    diagnostics: &mut Vec<NativeStaticDiagnostic>,
    files: &[String],
    known: &BTreeSet<String>,
) -> Vec<NativeStaticLintFinding> {
    let mut suppressions = parse_suppressions(files);
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

fn parse_suppressions(files: &[String]) -> Vec<LintSuppression> {
    let mut out = Vec::new();
    for file in files {
        let Ok(text) = fs::read_to_string(file) else {
            continue;
        };
        for (index, line) in text.lines().enumerate() {
            if let Some(suppression) = parse_suppression_line(file, index + 1, line) {
                out.push(suppression);
            }
        }
    }
    out
}

fn parse_suppression_line(file: &str, line: usize, text: &str) -> Option<LintSuppression> {
    let column = text.find("crux-lint-disable-")? + 1;
    let mut rest = &text[(column - 1 + "crux-lint-disable-".len())..];
    let scope = ["next-line", "line", "file"]
        .into_iter()
        .find(|scope| rest.starts_with(scope))?;
    rest = rest[scope.len()..].trim_start();
    let rule_len = rest
        .chars()
        .take_while(|character| {
            character.is_ascii_alphanumeric() || matches!(character, '@' | '_' | '.' | '/' | '-')
        })
        .count();
    if rule_len == 0 {
        return None;
    }
    let rule_id = rest[..rule_len].to_string();
    Some(LintSuppression {
        id: format!("{file}:{line}:{scope}:{rule_id}"),
        file: file.to_string(),
        line,
        column,
        scope: scope.to_string(),
        rule_id,
        used: false,
    })
}

fn suppresses(suppression: &LintSuppression, finding: &NativeStaticLintFinding) -> bool {
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

fn finding_source(finding: &NativeStaticLintFinding) -> Option<NativeStaticSourceLocation> {
    serde_json::from_value(finding.extra.get("source")?.clone()).ok()
}

fn parse_severity(value: &str) -> Option<NativeStaticDiagnosticSeverity> {
    match value {
        "info" => Some(NativeStaticDiagnosticSeverity::Info),
        "warning" => Some(NativeStaticDiagnosticSeverity::Warning),
        "error" => Some(NativeStaticDiagnosticSeverity::Error),
        _ => None,
    }
}

fn unknown_configured_rule_diagnostic(rule_id: &str) -> NativeStaticDiagnostic {
    NativeStaticDiagnostic {
        id: format!("index.lint_unknown_configured_rule:{rule_id}"),
        severity: NativeStaticDiagnosticSeverity::Warning,
        code: "index.lint_unknown_configured_rule".to_string(),
        message: format!("Crux lint config references unknown rule \"{rule_id}\"."),
        source: None,
        related_definition_ids: Vec::new(),
        suggested_fix: Some(
            "Remove the rule override or update it to a known Crux lint rule id.".to_string(),
        ),
    }
}

fn unknown_suppression_rule_diagnostic(suppression: &LintSuppression) -> NativeStaticDiagnostic {
    suppression_diagnostic(
        "index.lint_unknown_suppression_rule",
        &format!(
            "Unknown Crux lint rule \"{}\" in suppression comment.",
            suppression.rule_id
        ),
        "Use a known Crux lint rule id or remove the suppression comment.",
        suppression,
        NativeStaticDiagnosticSeverity::Warning,
    )
}

fn unused_suppression_diagnostic(suppression: &LintSuppression) -> NativeStaticDiagnostic {
    suppression_diagnostic(
        "index.lint_unused_suppression",
        &format!(
            "Crux lint suppression for \"{}\" did not match any finding.",
            suppression.rule_id
        ),
        "Remove the stale suppression or move it to the finding it is intended to suppress.",
        suppression,
        NativeStaticDiagnosticSeverity::Info,
    )
}

fn suppression_diagnostic(
    code: &str,
    message: &str,
    fix: &str,
    suppression: &LintSuppression,
    severity: NativeStaticDiagnosticSeverity,
) -> NativeStaticDiagnostic {
    NativeStaticDiagnostic {
        id: format!("{code}:{}", sanitize_key(&suppression.id)),
        severity,
        code: code.to_string(),
        message: message.to_string(),
        source: Some(NativeStaticSourceLocation {
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
