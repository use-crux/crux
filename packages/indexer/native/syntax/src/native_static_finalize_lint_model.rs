//! Post-merge lint model construction for native static finalization.

use std::collections::BTreeSet;

use serde_json::Value;

use crate::native_static_definition_merge::merge_definitions_by_id;
use crate::native_static_facts::NativeStaticIndexPatchFacts;
use crate::native_static_finalize::{append_missing_builtin_rule_descriptors, merge_fact_value};
use crate::native_static_lint_filter::NativeStaticLintOptions;
use crate::native_static_lints::append_builtin_lint_findings;
use crate::native_static_relations::{
    NativeStaticRelationPolicyTable, resolve_native_static_relation_model,
};
use crate::native_static_source_model::with_native_static_source_model;

pub(crate) fn apply_native_static_lint_model(
    facts: &mut NativeStaticIndexPatchFacts,
    lint_facts: &[Value],
    policies: &NativeStaticRelationPolicyTable,
    lint_options: &NativeStaticLintOptions,
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
    let relation_model = resolve_native_static_relation_model(lint_model, policies);
    let mut lint_model = with_native_static_source_model(relation_model.facts);
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
