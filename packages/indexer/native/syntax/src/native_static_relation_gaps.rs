//! Missing-policy relation gap aggregation.

use std::collections::{BTreeMap, BTreeSet};

use crate::native_static_relation_report::{
    NativeStaticRelationFactRef, NativeStaticRelationPolicyGap, record_policy_gap,
};

/// Records a missing relation-policy reference using TypeScript-compatible grouping.
pub(crate) fn record_policy_gap_once(
    policy_gaps: &mut BTreeMap<String, NativeStaticRelationPolicyGap>,
    seen: &mut BTreeSet<String>,
    fact: NativeStaticRelationFactRef,
) {
    if seen.insert(policy_gap_ref_key(&fact)) {
        let relation_type = fact.ref_type.clone();
        if policy_gaps
            .get(&relation_type)
            .is_none_or(|gap| gap.sample_fact.owner_definition_id == fact.owner_definition_id)
        {
            record_policy_gap(policy_gaps, &relation_type, fact);
        }
    }
}

fn policy_gap_ref_key(fact: &NativeStaticRelationFactRef) -> String {
    format!(
        "{}\u{0}{}\u{0}{}",
        fact.ref_type,
        fact.owner_definition_id,
        fact.to_id
            .as_deref()
            .or(fact.to_variable.as_deref())
            .unwrap_or("")
    )
}
