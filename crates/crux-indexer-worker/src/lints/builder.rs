//! Descriptor-backed helpers for native static lint findings.
//!
//! Built-in rule metadata stays in `builtin_rule_descriptors.json`
//! so Rust rule logic does not duplicate title, category, profile, fixes, or
//! docs metadata from the TypeScript rule catalog.

use std::collections::BTreeMap;

use serde_json::{Map, Value, json};

use crate::index_compiler::core::facts::{
    NativeStaticDefinition, NativeStaticDiagnosticSeverity, NativeStaticFidelity,
    NativeStaticLintFinding, NativeStaticRelation, NativeStaticRuleDescriptor,
    NativeStaticSourceLocation,
};

/// Returns built-in static lint descriptors from the native manifest.
pub(crate) fn builtin_rule_descriptors() -> Vec<NativeStaticRuleDescriptor> {
    serde_json::from_str(include_str!("builtin_rule_descriptors.json"))
        .expect("built-in native static rule descriptor manifest is valid JSON")
}

/// Builder that materializes normalized Project Index lint findings.
pub(crate) struct NativeStaticLintBuilder {
    descriptors: BTreeMap<String, NativeStaticRuleDescriptor>,
}

impl NativeStaticLintBuilder {
    /// Creates a builder backed by the built-in descriptor manifest.
    pub(crate) fn new() -> Self {
        Self {
            descriptors: builtin_rule_descriptors()
                .into_iter()
                .map(|descriptor| (descriptor.id.clone(), descriptor))
                .collect(),
        }
    }

    /// Builds one lint finding from rule metadata and finding-local evidence.
    pub(crate) fn finding(
        &self,
        input: NativeStaticLintFindingInput,
    ) -> Option<NativeStaticLintFinding> {
        let descriptor = self.descriptors.get(input.rule_id)?;
        let docs_url = descriptor.extra.get("docsUrl").and_then(Value::as_str);
        let suppression = descriptor.extra.get("suppression").cloned();
        let mut extra = BTreeMap::new();

        for key in [
            "category",
            "maturity",
            "confidence",
            "profiles",
            "rationale",
            "impact",
            "docsUrl",
        ] {
            if let Some(value) = descriptor.extra.get(key) {
                extra.insert(key.to_string(), value.clone());
            }
        }
        if let Some(source) = input.source {
            extra.insert("source".to_string(), to_value(source));
        }
        if let Some(primary) = input.primary_definition_id {
            extra.insert(
                "primaryDefinitionId".to_string(),
                Value::String(primary.to_string()),
            );
        }
        extra.insert(
            "relatedDefinitionIds".to_string(),
            string_array(input.related_definition_ids.iter().map(String::as_str)),
        );
        extra.insert(
            "affectedDefinitionIds".to_string(),
            string_array(affected_definition_ids(
                input.primary_definition_id,
                &input.related_definition_ids,
            )),
        );
        extra.insert("evidence".to_string(), Value::Array(input.evidence));
        extra.insert(
            "fixes".to_string(),
            Value::Array(finding_fixes(
                descriptor,
                docs_url,
                suppression.as_ref(),
                input.fixes,
            )),
        );
        if let Some(value) = docs_url {
            extra.insert("docsUrl".to_string(), Value::String(value.to_string()));
        }
        if let Some(value) = suppression {
            extra.insert("suppression".to_string(), value);
        }

        Some(NativeStaticLintFinding {
            id: format!("lint:{}:{}", input.rule_id, sanitize_finding_key(input.key)),
            severity: descriptor_severity(descriptor),
            rule_id: input.rule_id.to_string(),
            title: descriptor.title.clone(),
            message: input.message,
            extra,
        })
    }
}

/// Input accepted by `NativeStaticLintBuilder::finding`.
pub(crate) struct NativeStaticLintFindingInput<'a> {
    pub(crate) rule_id: &'a str,
    pub(crate) key: &'a str,
    pub(crate) message: String,
    pub(crate) source: Option<&'a NativeStaticSourceLocation>,
    pub(crate) primary_definition_id: Option<&'a str>,
    pub(crate) related_definition_ids: Vec<String>,
    pub(crate) evidence: Vec<Value>,
    pub(crate) fixes: Vec<Value>,
}

/// Builds evidence that points at a definition and its source location.
pub(crate) fn definition_evidence(definition: &NativeStaticDefinition, label: &str) -> Value {
    let mut evidence = Map::new();
    evidence.insert("kind".to_string(), Value::String("definition".to_string()));
    evidence.insert("label".to_string(), Value::String(label.to_string()));
    evidence.insert(
        "definitionId".to_string(),
        Value::String(definition.id.clone()),
    );
    if let Some(source) = &definition.source {
        evidence.insert("source".to_string(), to_value(source));
    }
    evidence.insert(
        "data".to_string(),
        json!({
            "kind": definition.kind,
            "name": definition.name,
            "fidelity": fidelity_json_name(definition.fidelity),
        }),
    );
    Value::Object(evidence)
}

/// Builds evidence that points at a relation and its source location.
pub(crate) fn relation_evidence(relation: &NativeStaticRelation, label: &str) -> Value {
    let mut evidence = Map::new();
    evidence.insert("kind".to_string(), Value::String("relation".to_string()));
    evidence.insert("label".to_string(), Value::String(label.to_string()));
    evidence.insert("relationId".to_string(), Value::String(relation.id.clone()));
    if let Some(source) = &relation.source {
        evidence.insert("source".to_string(), to_value(source));
    }
    evidence.insert(
        "data".to_string(),
        json!({
            "type": relation.r#type,
            "from": relation.from,
            "to": relation.to,
            "fidelity": fidelity_json_name(relation.fidelity),
        }),
    );
    Value::Object(evidence)
}

pub(crate) fn string_array<'a>(values: impl IntoIterator<Item = &'a str>) -> Value {
    Value::Array(
        values
            .into_iter()
            .map(|value| Value::String(value.to_string()))
            .collect(),
    )
}

pub(crate) fn to_value<T: serde::Serialize>(value: &T) -> Value {
    serde_json::to_value(value).expect("native static lint value should serialize")
}

fn descriptor_severity(descriptor: &NativeStaticRuleDescriptor) -> NativeStaticDiagnosticSeverity {
    match descriptor.extra.get("severity").and_then(Value::as_str) {
        Some("warning") => NativeStaticDiagnosticSeverity::Warning,
        Some("error") => NativeStaticDiagnosticSeverity::Error,
        _ => NativeStaticDiagnosticSeverity::Info,
    }
}

fn finding_fixes(
    descriptor: &NativeStaticRuleDescriptor,
    docs_url: Option<&str>,
    suppression: Option<&Value>,
    extra_fixes: Vec<Value>,
) -> Vec<Value> {
    let mut fixes = descriptor
        .extra
        .get("fixes")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    fixes.extend(extra_fixes);
    if let Some(docs_url) = docs_url {
        fixes.push(json!({
            "title": "Read rule docs",
            "description": "Open the rule documentation for examples, trade-offs, and suppression guidance.",
            "kind": "docs",
            "docsUrl": docs_url,
        }));
    }
    let suppression_directive = suppression
        .and_then(Value::as_object)
        .and_then(|object| object.get("directive"))
        .and_then(Value::as_str);
    let suppression_supported = suppression
        .and_then(Value::as_object)
        .and_then(|object| object.get("supported"))
        .and_then(Value::as_bool)
        .unwrap_or(false);
    if suppression_supported {
        if let Some(directive) = suppression_directive {
            fixes.push(json!({
                "title": "Suppress intentionally",
                "description": "Use a rule-specific source comment only when this finding is intentional and documented.",
                "kind": "suppress",
                "suppression": directive,
            }));
        }
    }
    fixes
}

fn affected_definition_ids<'a>(primary: Option<&'a str>, related: &'a [String]) -> Vec<&'a str> {
    let mut affected = Vec::new();
    if let Some(primary) = primary {
        affected.push(primary);
    }
    for id in related {
        if !affected.contains(&id.as_str()) {
            affected.push(id);
        }
    }
    affected
}

fn sanitize_finding_key(value: &str) -> String {
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

fn fidelity_json_name(fidelity: NativeStaticFidelity) -> &'static str {
    match fidelity {
        NativeStaticFidelity::Resolved => "resolved",
        NativeStaticFidelity::Partial => "partial",
        NativeStaticFidelity::Error => "error",
    }
}
