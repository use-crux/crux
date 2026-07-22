//! Annotation and diagnostics for prepared lint suppression directives.

use std::collections::BTreeSet;

use crate::facts::{
    StaticIndexDiagnostic, StaticIndexDiagnosticSeverity, StaticIndexLintFinding,
    StaticIndexLintSuppressedBy, StaticIndexLintSuppressionScope as FactScope,
    StaticIndexSourceLocation,
};
use crate::filter::{StaticIndexLintSuppression, StaticIndexLintSuppressionScope};

pub(crate) fn annotate_suppressions(
    findings: Vec<StaticIndexLintFinding>,
    diagnostics: &mut Vec<StaticIndexDiagnostic>,
    suppressions: &[StaticIndexLintSuppression],
    known: &BTreeSet<String>,
) -> Vec<StaticIndexLintFinding> {
    let mut suppressions = suppressions
        .iter()
        .map(PreparedSuppression::from)
        .collect::<Vec<_>>();
    for suppression in &suppressions {
        if !known.contains(&suppression.rule_id) {
            diagnostics.push(unknown_rule_diagnostic(suppression));
        }
    }

    let findings = findings
        .into_iter()
        .map(|mut finding| {
            finding.suppressed = false;
            finding.suppressed_by = None;
            if let Some(suppression) = suppressions.iter_mut().find(|suppression| {
                known.contains(&suppression.rule_id) && suppression.matches(&finding)
            }) {
                suppression.used = true;
                finding.suppressed = true;
                finding.suppressed_by = Some(suppression.metadata());
            }
            finding
        })
        .collect();

    for suppression in suppressions {
        if known.contains(&suppression.rule_id) && !suppression.used {
            diagnostics.push(unused_diagnostic(&suppression));
        }
    }
    findings
}

#[derive(Debug, Clone)]
struct PreparedSuppression {
    id: String,
    file: String,
    line: usize,
    column: usize,
    scope: StaticIndexLintSuppressionScope,
    rule_id: String,
    reason: Option<String>,
    used: bool,
}

impl PreparedSuppression {
    fn matches(&self, finding: &StaticIndexLintFinding) -> bool {
        if finding.rule_id != self.rule_id {
            return false;
        }
        let Some(source) = finding_source(finding) else {
            return false;
        };
        if source.file != self.file {
            return false;
        }
        match self.scope {
            StaticIndexLintSuppressionScope::File => true,
            StaticIndexLintSuppressionScope::Line => source.line == self.line,
            StaticIndexLintSuppressionScope::NextLine => source.line == self.line + 1,
        }
    }

    fn metadata(&self) -> StaticIndexLintSuppressedBy {
        StaticIndexLintSuppressedBy {
            source: StaticIndexSourceLocation {
                file: self.file.clone(),
                line: self.line,
                column: Some(self.column),
                function_name: None,
            },
            scope: match self.scope {
                StaticIndexLintSuppressionScope::NextLine => FactScope::NextLine,
                StaticIndexLintSuppressionScope::Line => FactScope::Line,
                StaticIndexLintSuppressionScope::File => FactScope::File,
            },
            reason: self.reason.clone(),
        }
    }
}

impl From<&StaticIndexLintSuppression> for PreparedSuppression {
    fn from(input: &StaticIndexLintSuppression) -> Self {
        Self {
            id: format!(
                "{}:{}:{}:{}",
                input.file,
                input.line,
                input.scope.as_str(),
                input.rule_id
            ),
            file: input.file.clone(),
            line: input.line,
            column: input.column,
            scope: input.scope,
            rule_id: input.rule_id.clone(),
            reason: input.reason.clone(),
            used: false,
        }
    }
}

fn finding_source(finding: &StaticIndexLintFinding) -> Option<StaticIndexSourceLocation> {
    serde_json::from_value(finding.extra.get("source")?.clone()).ok()
}

fn unknown_rule_diagnostic(suppression: &PreparedSuppression) -> StaticIndexDiagnostic {
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

fn unused_diagnostic(suppression: &PreparedSuppression) -> StaticIndexDiagnostic {
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
    suppression: &PreparedSuppression,
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
