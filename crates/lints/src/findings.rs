//! Built-in graph lint orchestration for native static finalization.

use std::collections::{BTreeMap, BTreeSet};

use crate::builder::NativeStaticLintBuilder;
use crate::facts::{NativeStaticIndexPatchFacts, NativeStaticLintFinding};
use crate::filter::{NativeStaticLintOptions, apply_lint_filters};
use crate::injection::rules::injection_lint_findings;
use crate::propagation::propagate_findings;
use crate::rules::core::core_lint_findings;

/// Appends built-in first-party lint findings to finalized native facts.
pub fn append_builtin_lint_findings(
    facts: &mut NativeStaticIndexPatchFacts,
    options: &NativeStaticLintOptions,
) {
    let mut seen = facts
        .lint_findings
        .iter()
        .map(|finding| finding.id.clone())
        .collect::<BTreeSet<_>>();
    if options.emit_builtin_lints {
        for finding in builtin_index_lint_findings(facts) {
            if seen.insert(finding.id.clone()) {
                facts.lint_findings.push(finding);
            }
        }
    }
    facts.lint_findings = apply_lint_filters(
        std::mem::take(&mut facts.lint_findings),
        &mut facts.diagnostics,
        options,
        &facts.rule_descriptors,
    );
}

fn builtin_index_lint_findings(
    facts: &NativeStaticIndexPatchFacts,
) -> Vec<NativeStaticLintFinding> {
    let builder = NativeStaticLintBuilder::new();
    let by_id = facts
        .definitions
        .iter()
        .map(|definition| (definition.id.as_str(), definition))
        .collect::<BTreeMap<_, _>>();
    let mut findings = core_lint_findings(&builder, facts, &by_id);
    findings.extend(injection_lint_findings(&builder, facts, &by_id));
    propagate_findings(findings, &facts.relations)
}
