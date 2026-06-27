//! Post-merge lint model construction for Static Index finalization.

use std::collections::BTreeSet;

use serde_json::Value;

use crate::core::definition_merge::merge_definitions_by_id;
use crate::core::facts::StaticIndexPatchFacts;
use crate::finalizer::run::{append_missing_builtin_rule_descriptors, merge_fact_value};
use crate::lints::filter::StaticIndexLintOptions;
use crate::lints::findings::append_builtin_lint_findings;
use crate::relation::model::{StaticIndexRelationPolicyTable, resolve_static_index_relation_model};
use crate::source::model::with_static_index_source_model;

pub(crate) fn apply_static_index_lint_model(
    facts: &mut StaticIndexPatchFacts,
    lint_facts: &[Value],
    policies: &StaticIndexRelationPolicyTable,
    lint_options: &StaticIndexLintOptions,
) {
    if lint_facts.is_empty() {
        append_builtin_lint_findings(facts, lint_options);
        return;
    }

    let mut lint_model = facts.clone();
    for value in lint_facts {
        merge_fact_value(&mut lint_model, value);
    }
    lint_model.definitions = merge_definitions_by_id(lint_model.definitions);
    append_missing_builtin_rule_descriptors(&mut lint_model);
    lint_model.canonicalize();
    let before_diagnostic_ids = lint_model
        .diagnostics
        .iter()
        .map(|diagnostic| diagnostic.id.clone())
        .collect::<BTreeSet<_>>();
    let relation_model = resolve_static_index_relation_model(lint_model, policies);
    let mut lint_model = with_static_index_source_model(relation_model.facts);
    append_builtin_lint_findings(&mut lint_model, lint_options);
    facts.lint_findings = lint_model.lint_findings;
    facts.rule_descriptors = lint_model.rule_descriptors;
    facts.diagnostics.extend(
        lint_model
            .diagnostics
            .into_iter()
            .filter(|diagnostic| !before_diagnostic_ids.contains(&diagnostic.id)),
    );
}
