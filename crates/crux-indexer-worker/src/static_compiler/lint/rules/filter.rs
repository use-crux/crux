//! Rule id/profile helpers for native lint filtering.

use std::collections::BTreeSet;

use serde_json::Value;

use crate::static_compiler::core::facts::{NativeStaticLintFinding, NativeStaticRuleDescriptor};
use crate::static_compiler::lint::builder::builtin_rule_descriptors;

pub(crate) fn finding_profiles(finding: &NativeStaticLintFinding) -> BTreeSet<String> {
    finding
        .extra
        .get("profiles")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
        .map(str::to_string)
        .collect()
}

pub(crate) fn known_rule_ids(rule_descriptors: &[NativeStaticRuleDescriptor]) -> BTreeSet<String> {
    let mut known = builtin_rule_descriptors()
        .into_iter()
        .map(|descriptor| descriptor.id)
        .collect::<BTreeSet<_>>();
    known.extend(
        rule_descriptors
            .iter()
            .map(|descriptor| descriptor.id.clone()),
    );
    known
}
