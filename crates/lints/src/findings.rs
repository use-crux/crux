//! Built-in graph lint orchestration for Static Index finalization.

use std::collections::{BTreeMap, BTreeSet};

use crate::builder::StaticIndexLintBuilder;
use crate::facts::{StaticIndexLintFinding, StaticIndexPatchFacts};
use crate::filter::{StaticIndexLintOptions, apply_lint_filters};
use crate::injection::rules::injection_lint_findings;
use crate::propagation::propagate_findings;
use crate::rules::core::core_lint_findings;
use crate::rules::runtime::runtime_lint_findings;

/// Appends built-in first-party lint findings to finalized native facts.
pub fn append_builtin_lint_findings(
    facts: &mut StaticIndexPatchFacts,
    options: &StaticIndexLintOptions,
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

fn builtin_index_lint_findings(facts: &StaticIndexPatchFacts) -> Vec<StaticIndexLintFinding> {
    let builder = StaticIndexLintBuilder::new();
    let by_id = facts
        .definitions
        .iter()
        .map(|definition| (definition.id.as_str(), definition))
        .collect::<BTreeMap<_, _>>();
    let mut findings = core_lint_findings(&builder, facts, &by_id);
    findings.extend(runtime_lint_findings(
        &builder,
        facts,
        facts
            .project
            .as_ref()
            .and_then(|project| project.runtime_configured),
    ));
    findings.extend(injection_lint_findings(&builder, facts, &by_id));
    propagate_findings(findings, &facts.relations)
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;
    use crate::filter::StaticIndexLintOptions;

    #[test]
    fn defer_replay_finding_suppresses_site_local_scope_and_runtime_findings() {
        let mut facts: StaticIndexPatchFacts = serde_json::from_value(json!({
            "project": { "root": "/fixture", "runtimeConfigured": false },
            "definitions": [
                {
                    "id": "flow:send", "kind": "flow", "name": "send",
                    "fidelity": "resolved", "metadata": {}
                },
                {
                    "id": "deferred-work:named:src-api.ts:769911c416ccf851:1",
                    "kind": "deferred-work", "name": "named deferred work",
                    "fidelity": "resolved",
                    "metadata": { "mode": "named", "consumed": false, "eagerExecution": true }
                }
            ],
            "relations": [{
                "id": "relation:defer.contained_by:deferred:flow",
                "type": "defer.contained_by",
                "from": "deferred-work:named:src-api.ts:769911c416ccf851:1",
                "to": "flow:send",
                "fidelity": "resolved"
            }]
        }))
        .expect("fixture facts decode");

        append_builtin_lint_findings(&mut facts, &StaticIndexLintOptions::default());
        let rule_ids = facts
            .lint_findings
            .iter()
            .map(|finding| finding.rule_id.as_str())
            .collect::<Vec<_>>();
        assert!(rule_ids.contains(&"defer.replay_unsafe"));
        assert!(!rule_ids.contains(&"defer.floating_named_promise"));
        assert!(!rule_ids.contains(&"defer.missing_scope"));
        assert!(!rule_ids.contains(&"runtime.missing_runtime_config"));
    }

    #[test]
    fn named_defer_reports_only_source_decidable_and_explicit_runtime_evidence() {
        let mut facts: StaticIndexPatchFacts = serde_json::from_value(json!({
            "project": { "root": "/fixture", "runtimeConfigured": false },
            "definitions": [{
                "id": "deferred-work:named:src-api.ts:769911c416ccf851:1",
                "kind": "deferred-work", "name": "named deferred work",
                "fidelity": "resolved",
                "metadata": { "mode": "named", "consumed": false, "eagerExecution": true }
            }]
        }))
        .expect("fixture facts decode");

        append_builtin_lint_findings(&mut facts, &StaticIndexLintOptions::default());
        let rule_ids = facts
            .lint_findings
            .iter()
            .map(|finding| finding.rule_id.as_str())
            .collect::<Vec<_>>();
        assert!(rule_ids.contains(&"defer.floating_named_promise"));
        assert!(!rule_ids.contains(&"defer.missing_scope"));
        assert!(rule_ids.contains(&"runtime.missing_runtime_config"));
    }
}
