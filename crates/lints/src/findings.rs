//! Built-in graph lint orchestration for Static Index finalization.

use std::collections::{BTreeMap, BTreeSet};

use crate::builder::StaticIndexLintBuilder;
use crate::facts::{StaticIndexDefinition, StaticIndexLintFinding, StaticIndexPatchFacts};
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
    let definition_occurrences = facts.definitions.clone();
    append_builtin_lint_findings_with_definition_occurrences(
        facts,
        options,
        &definition_occurrences,
    );
}

/// Appends built-in findings while retaining pre-merge definition occurrences.
pub fn append_builtin_lint_findings_with_definition_occurrences(
    facts: &mut StaticIndexPatchFacts,
    options: &StaticIndexLintOptions,
    definition_occurrences: &[StaticIndexDefinition],
) {
    let mut seen = facts
        .lint_findings
        .iter()
        .map(|finding| finding.id.clone())
        .collect::<BTreeSet<_>>();
    if options.emit_builtin_lints {
        for finding in builtin_index_lint_findings(facts, definition_occurrences) {
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
    facts: &StaticIndexPatchFacts,
    definition_occurrences: &[StaticIndexDefinition],
) -> Vec<StaticIndexLintFinding> {
    let builder = StaticIndexLintBuilder::new();
    let by_id = facts
        .definitions
        .iter()
        .map(|definition| (definition.id.as_str(), definition))
        .collect::<BTreeMap<_, _>>();
    let mut findings = core_lint_findings(&builder, facts, definition_occurrences, &by_id);
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
    use serde_json::{Value, json};

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

    #[test]
    fn effect_duplicate_identity_requires_distinct_definition_source_evidence() {
        let effect = |version: f64, source_refs: Value| {
            serde_json::from_value::<StaticIndexPatchFacts>(json!({
                "definitions": [{
                    "id": "effect:payments.charge:v2",
                    "kind": "effect",
                    "name": "payments.charge",
                    "fidelity": "resolved",
                    "metadata": {
                        "facts": {
                            "kind": "effect",
                            "effectId": "payments.charge",
                            "version": version,
                            "recoverable": true,
                            "capture": false,
                            "resource": true
                        }
                    },
                    "sourceRefs": source_refs
                }]
            }))
            .expect("effect fixture facts decode")
        };
        let source_ref = |id: &str, line: usize| {
            json!({
                "id": id,
                "role": "execute",
                "property": "executor",
                "symbol": "execute",
                "source": { "file": "src/effects.ts", "line": line },
                "fidelity": "resolved"
            })
        };

        let mut duplicate = effect(
            1.5,
            json!([
                source_ref("effect:payments.charge:v2:execute:1", 3),
                source_ref("effect:payments.charge:v2:execute:2", 8)
            ]),
        );
        append_builtin_lint_findings(&mut duplicate, &StaticIndexLintOptions::default());
        let finding = duplicate
            .lint_findings
            .iter()
            .find(|finding| finding.rule_id == "effect.duplicate_identity")
            .expect("duplicate Effect identity finding");
        assert_eq!(
            finding
                .extra
                .get("evidence")
                .and_then(Value::as_array)
                .map(Vec::len),
            Some(2)
        );

        let mut reexport = effect(
            1.5,
            json!([source_ref("effect:payments.charge:v2:execute:1", 3)]),
        );
        append_builtin_lint_findings(&mut reexport, &StaticIndexLintOptions::default());
        assert!(
            reexport
                .lint_findings
                .iter()
                .all(|finding| finding.rule_id != "effect.duplicate_identity")
        );
    }

    #[test]
    fn irreversible_effect_requires_explicit_required_boundary_evidence() {
        let mut facts: StaticIndexPatchFacts = serde_json::from_value(json!({
            "definitions": [{
                "id": "effect:inventory.reserve:v1",
                "kind": "effect",
                "name": "inventory.reserve",
                "fidelity": "resolved",
                "metadata": {
                    "facts": {
                        "kind": "effect",
                        "effectId": "inventory.reserve",
                        "version": 1,
                        "recoverable": false,
                        "capture": false,
                        "resource": false
                    }
                },
                "sourceRefs": [{
                    "id": "effect:inventory.reserve:v1:required-boundary:1",
                    "role": "config",
                    "property": "rollbackOnError.recovery",
                    "symbol": "rollbackOnError",
                    "source": { "file": "src/effects.ts", "line": 8, "column": 1 },
                    "fidelity": "resolved"
                }]
            }]
        }))
        .expect("effect boundary fixture facts decode");

        append_builtin_lint_findings(&mut facts, &StaticIndexLintOptions::default());
        let finding = facts
            .lint_findings
            .iter()
            .find(|finding| finding.rule_id == "effect.irreversible_in_required_boundary")
            .expect("irreversible Effect boundary finding");
        assert!(finding.message.contains("inventory.reserve"));
        assert!(finding.message.contains("src/effects.ts:8"));
        for action in ["Define recovery", "move the Effect outside", "best-effort"] {
            assert!(
                finding.message.contains(action),
                "message={}",
                finding.message
            );
        }
    }

    #[test]
    fn recoverable_effect_requires_runtime_addressable_export() {
        let mut facts: StaticIndexPatchFacts = serde_json::from_value(json!({
            "project": { "root": "/fixture", "runtimeConfigured": true },
            "definitions": [
                {
                    "id": "effect:customer.local:v1",
                    "kind": "effect",
                    "name": "customer.local",
                    "fidelity": "resolved",
                    "source": { "file": "src/effects.ts", "line": 3 },
                    "metadata": {
                        "facts": {
                            "kind": "effect",
                            "effectId": "customer.local",
                            "version": 1,
                            "recoverable": true
                        }
                    },
                    "sourceRefs": [{
                        "id": "effect:customer.local:v1:required-boundary:1",
                        "role": "config",
                        "property": "rollbackOnError.recovery",
                        "symbol": "rollbackOnError",
                        "source": { "file": "src/effects.ts", "line": 18 },
                        "fidelity": "resolved"
                    }]
                },
                {
                    "id": "effect:customer.exported:v1",
                    "kind": "effect",
                    "name": "customer.exported",
                    "fidelity": "resolved",
                    "source": { "file": "src/effects.ts", "line": 8 },
                    "metadata": {
                        "exported": true,
                        "facts": {
                            "kind": "effect",
                            "effectId": "customer.exported",
                            "version": 1,
                            "recoverable": true
                        }
                    }
                },
                {
                    "id": "effect:customer.unused:v1",
                    "kind": "effect",
                    "name": "customer.unused",
                    "fidelity": "resolved",
                    "source": { "file": "src/effects.ts", "line": 15 },
                    "metadata": {
                        "facts": {
                            "kind": "effect",
                            "effectId": "customer.unused",
                            "version": 1,
                            "recoverable": true
                        }
                    }
                },
                {
                    "id": "effect:customer.irreversible:v1",
                    "kind": "effect",
                    "name": "customer.irreversible",
                    "fidelity": "resolved",
                    "source": { "file": "src/effects.ts", "line": 12 },
                    "metadata": {
                        "facts": {
                            "kind": "effect",
                            "effectId": "customer.irreversible",
                            "version": 1,
                            "recoverable": false
                        }
                    }
                }
            ]
        }))
        .expect("runtime-addressability fixture facts decode");

        append_builtin_lint_findings(&mut facts, &StaticIndexLintOptions::default());
        let findings = facts
            .lint_findings
            .iter()
            .filter(|finding| finding.rule_id == "effect.recovery_not_runtime_addressable")
            .collect::<Vec<_>>();

        assert_eq!(findings.len(), 1, "findings={findings:?}");
        assert!(findings[0].message.contains("customer.local"));
        assert!(findings[0].message.contains("export"));

        let mut no_runtime: StaticIndexPatchFacts = serde_json::from_value(json!({
            "project": { "root": "/fixture", "runtimeConfigured": false },
            "definitions": [{
                "id": "effect:customer.local:v1",
                "kind": "effect",
                "name": "customer.local",
                "fidelity": "resolved",
                "metadata": {
                    "facts": {
                        "kind": "effect",
                        "effectId": "customer.local",
                        "version": 1,
                        "recoverable": true
                    }
                },
                "sourceRefs": [{
                    "id": "effect:customer.local:v1:required-boundary:1",
                    "role": "config",
                    "property": "rollbackOnError.recovery",
                    "symbol": "rollbackOnError",
                    "source": { "file": "src/effects.ts", "line": 18 },
                    "fidelity": "resolved"
                }]
            }]
        }))
        .expect("non-runtime Effect fixture facts decode");
        append_builtin_lint_findings(&mut no_runtime, &StaticIndexLintOptions::default());
        assert!(
            no_runtime
                .lint_findings
                .iter()
                .all(|finding| finding.rule_id != "effect.recovery_not_runtime_addressable")
        );
    }
}
