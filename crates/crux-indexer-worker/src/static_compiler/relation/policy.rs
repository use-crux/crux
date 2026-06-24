//! Relation policy table used by native static binding.

use std::collections::BTreeMap;

use serde::{Deserialize, Deserializer, Serialize, de};
use serde_json::Value;

use crate::static_compiler::core::facts::{NativeStaticDiagnostic, NativeStaticDiagnosticSeverity};

/// Describes how one relation type may bind and appear in the graph.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct NativeStaticRelationPolicy {
    #[serde(rename = "type")]
    pub r#type: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub from_kinds: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub to_kinds: Vec<String>,
    pub presentation: String,
    pub partial: bool,
    pub runtime_join: bool,
}

impl<'de> Deserialize<'de> for NativeStaticRelationPolicy {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        NativeStaticRelationPolicyInput::deserialize(deserializer)?
            .into_policy()
            .map_err(de::Error::custom)
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct NativeStaticRelationPolicyInput {
    #[serde(rename = "type")]
    r#type: String,
    #[serde(default)]
    from_kinds: Vec<String>,
    #[serde(default)]
    to_kinds: Vec<String>,
    #[serde(default = "default_relation_presentation")]
    presentation: String,
    partial: Option<bool>,
    fidelity: Option<String>,
    #[serde(default)]
    runtime_join: bool,
}

impl NativeStaticRelationPolicyInput {
    fn into_policy(self) -> Result<NativeStaticRelationPolicy, String> {
        let partial = match (self.partial, self.fidelity.as_deref()) {
            (Some(partial), _) => partial,
            (None, Some("resolved")) => false,
            (None, Some("partial") | None) => true,
            (None, Some(fidelity)) => {
                return Err(format!(
                    "Unsupported relation fidelity \"{fidelity}\" for \"{}\".",
                    self.r#type
                ));
            }
        };
        Ok(NativeStaticRelationPolicy {
            r#type: self.r#type,
            from_kinds: self.from_kinds,
            to_kinds: self.to_kinds,
            presentation: self.presentation,
            partial,
            runtime_join: self.runtime_join,
        })
    }
}

/// Lookup table that preserves first-policy-wins behavior while reporting duplicates.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct NativeStaticRelationPolicyTable {
    policies: Vec<NativeStaticRelationPolicy>,
    by_type: BTreeMap<String, usize>,
    pub validation: Vec<NativeStaticDiagnostic>,
}

impl NativeStaticRelationPolicyTable {
    /// Builds a deterministic policy table from ordered policy groups.
    pub(crate) fn new(groups: Vec<Vec<NativeStaticRelationPolicy>>) -> Self {
        let mut policies = Vec::new();
        let mut by_type = BTreeMap::new();
        let mut validation = Vec::new();
        for policy in groups.into_iter().flatten() {
            if by_type.contains_key(&policy.r#type) {
                validation.push(policy_table_diagnostic(&policy.r#type));
                continue;
            }
            by_type.insert(policy.r#type.clone(), policies.len());
            policies.push(policy);
        }
        Self {
            policies,
            by_type,
            validation,
        }
    }

    /// Returns the policy for a relation type in O(log n) deterministic lookup.
    pub(crate) fn policy_for(&self, relation_type: &str) -> Option<&NativeStaticRelationPolicy> {
        self.by_type
            .get(relation_type)
            .and_then(|index| self.policies.get(*index))
    }
}

/// Built-in first-party relation policy table used when Go omits relation specs.
#[cfg(test)]
pub(crate) fn built_in_relation_policy_table() -> NativeStaticRelationPolicyTable {
    let policies = serde_json::from_str::<Vec<NativeStaticRelationPolicy>>(include_str!(
        "builtin_relation_specs.json"
    ))
    .expect("built-in native static relation policy manifest is valid JSON");
    NativeStaticRelationPolicyTable::new(vec![policies])
}

/// Parses manifest-provided relation specs into a policy table.
#[cfg(test)]
pub(crate) fn relation_policy_table_from_value(
    value: Option<&Value>,
) -> Option<NativeStaticRelationPolicyTable> {
    relation_policy_groups_from_value(value).map(NativeStaticRelationPolicyTable::new)
}

/// Parses manifest-provided relation specs and appends them after built-ins.
pub(crate) fn relation_policy_table_from_value_with_builtins(
    value: Option<&Value>,
) -> NativeStaticRelationPolicyTable {
    let built_ins = serde_json::from_str::<Vec<NativeStaticRelationPolicy>>(include_str!(
        "builtin_relation_specs.json"
    ))
    .expect("built-in native static relation policy manifest is valid JSON");
    let mut groups = vec![built_ins];
    if let Some(extension_groups) = relation_policy_groups_from_value(value) {
        groups.extend(extension_groups);
    }
    NativeStaticRelationPolicyTable::new(groups)
}

fn relation_policy_groups_from_value(
    value: Option<&Value>,
) -> Option<Vec<Vec<NativeStaticRelationPolicy>>> {
    let value = value?;
    if let Ok(policies) = relation_policies_from_value(value) {
        return Some(vec![policies]);
    }
    if let Ok(specs) = serde_json::from_value::<NativeStaticRelationSpecs>(value.clone()) {
        if let Some(groups) = specs.groups {
            return Some(groups);
        }
        if let Some(policies) = specs.policies {
            return Some(vec![policies]);
        }
        if let Some(relations) = specs.relations {
            return Some(vec![relations]);
        }
    }
    None
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct NativeStaticRelationSpecs {
    policies: Option<Vec<NativeStaticRelationPolicy>>,
    groups: Option<Vec<Vec<NativeStaticRelationPolicy>>>,
    relations: Option<Vec<NativeStaticRelationPolicy>>,
}

fn relation_policies_from_value(
    value: &Value,
) -> Result<Vec<NativeStaticRelationPolicy>, serde_json::Error> {
    serde_json::from_value::<Vec<NativeStaticRelationPolicy>>(value.clone())
}

fn default_relation_presentation() -> String {
    "both".to_string()
}

fn policy_table_diagnostic(relation_type: &str) -> NativeStaticDiagnostic {
    NativeStaticDiagnostic {
        id: format!("relation.policy_table_invalid:duplicate:{relation_type}"),
        severity: NativeStaticDiagnosticSeverity::Error,
        code: "relation.policy_table_invalid".to_string(),
        message: format!("Duplicate relation policy for \"{relation_type}\"."),
        source: None,
        related_definition_ids: vec![relation_type.to_string()],
        suggested_fix: None,
    }
}
