//! Shared evidence helpers for native injection lint rules.

use std::collections::{BTreeMap, BTreeSet};

use serde_json::{Map, Value, json};

use crate::builder::definition_evidence;
use crate::facts::{StaticIndexDefinition, StaticIndexRelation};
use crate::injection::evidence_data::{generic_contribution_evidence, input_contribution_evidence};

pub(crate) fn contribution_evidence(
    owner: &StaticIndexDefinition,
    source: Option<&StaticIndexDefinition>,
    contribution: &Value,
    owner_label: &str,
    source_label: &str,
    contribution_label: &str,
) -> Vec<Value> {
    let mut evidence = vec![definition_evidence(owner, owner_label)];
    if let Some(source) = source {
        evidence.push(definition_evidence(source, source_label));
    }
    evidence.push(input_contribution_evidence(
        owner,
        contribution,
        contribution_label,
    ));
    evidence
}

pub(crate) fn condition_evidence(
    prompt: &StaticIndexDefinition,
    source: Option<&StaticIndexDefinition>,
    contribution: &Value,
) -> Vec<Value> {
    let mut evidence = contribution_evidence(
        prompt,
        source,
        contribution,
        "Prompt receives a conditional injected input",
        "Injected source requires the field",
        "Conditional required input contribution",
    );
    evidence.extend(condition_source_evidence(prompt, contribution));
    evidence
}

pub(crate) fn conflict_evidence(
    prompt: &StaticIndexDefinition,
    left: &Value,
    right: &Value,
    left_source: Option<&StaticIndexDefinition>,
    right_source: Option<&StaticIndexDefinition>,
) -> Vec<Value> {
    let mut evidence = vec![definition_evidence(
        prompt,
        "Prompt receives conflicting injected input",
    )];
    if let Some(source) = left_source {
        evidence.push(definition_evidence(
            source,
            "First injected schema contributor",
        ));
    }
    if let Some(source) = right_source {
        evidence.push(definition_evidence(
            source,
            "Second injected schema contributor",
        ));
    }
    evidence.push(input_contribution_evidence(
        prompt,
        left,
        "First injected input contribution",
    ));
    evidence.push(input_contribution_evidence(
        prompt,
        right,
        "Second injected input contribution",
    ));
    evidence
}

pub(crate) fn tool_contribution_evidence(
    owner: &StaticIndexDefinition,
    source: Option<&StaticIndexDefinition>,
    contribution: &Value,
    owner_label: &str,
    source_label: &str,
    contribution_label: &str,
) -> Vec<Value> {
    let mut evidence = vec![definition_evidence(owner, owner_label)];
    if let Some(source) = source {
        evidence.push(definition_evidence(source, source_label));
    }
    evidence.push(generic_contribution_evidence(
        owner,
        contribution,
        contribution_label,
        &["name", "variable", "path", "conditionality", "branch"],
    ));
    evidence
}

pub(crate) fn entry_evidence(
    definition: &StaticIndexDefinition,
    owner: Option<&StaticIndexDefinition>,
    entry: &Value,
    definition_label: &str,
    entry_label: &str,
) -> Vec<Value> {
    let mut evidence = vec![definition_evidence(definition, definition_label)];
    if let Some(owner) = owner.filter(|owner| owner.id != definition.id) {
        let label = entry_label.replace(" entry", " owner");
        evidence.push(definition_evidence(owner, &label));
    }
    let mut data = Map::new();
    for key in ["variable", "conditionality", "via", "branch"] {
        if let Some(value) = entry.get(key) {
            data.insert(key.to_string(), value.clone());
        }
    }
    evidence.push(json!({
        "kind": "definition",
        "label": entry_label,
        "definitionId": entry.get("ownerDefinitionId").and_then(Value::as_str).unwrap_or(definition.id.as_str()),
        "source": owner.and_then(|owner| owner.source.as_ref()).or(definition.source.as_ref()),
        "data": Value::Object(data),
    }));
    evidence
}

pub(crate) fn condition_source_evidence(
    owner: &StaticIndexDefinition,
    contribution: &Value,
) -> Vec<Value> {
    let expected = match contribution.get("conditionality").and_then(Value::as_str) {
        Some("when") => &["when-predicate", "when-target"][..],
        Some("match-case") => &["match-case"][..],
        Some("match-default") => &["match-default"][..],
        Some("binary-guard") => &["binary-guard"][..],
        _ => &[][..],
    };
    owner
        .source_refs
        .iter()
        .filter(|source_ref| source_ref.property.as_deref() == Some("use"))
        .filter(|source_ref| {
            let extensions = source_ref.metadata.as_ref().and_then(|metadata| metadata.get("extensions"));
            let condition = extensions
                .and_then(|extensions| extensions.get("injectionCondition"))
                .and_then(Value::as_str);
            condition.is_some_and(|condition| expected.contains(&condition))
        })
        .filter(|source_ref| {
            let branch = source_ref
                .metadata
                .as_ref()
                .and_then(|metadata| metadata.get("extensions"))
                .and_then(|extensions| extensions.get("branch"))
                .and_then(Value::as_str);
            contribution
                .get("branch")
                .and_then(Value::as_str)
                .map(|expected| branch == Some(expected))
                .unwrap_or(true)
        })
        .map(|source_ref| {
            let extensions = source_ref.metadata.as_ref().and_then(|metadata| metadata.get("extensions"));
            json!({
                "kind": "source",
                "label": "Injection condition source",
                "source": source_ref.source,
                "data": {
                    "definitionId": owner.id,
                    "role": source_ref.role,
                    "property": source_ref.property,
                    "symbol": source_ref.symbol,
                    "fidelity": source_ref.fidelity,
                    "injectionCondition": extensions.and_then(|extensions| extensions.get("injectionCondition")).cloned(),
                    "via": extensions.and_then(|extensions| extensions.get("via")).cloned(),
                    "branch": extensions.and_then(|extensions| extensions.get("branch")).cloned(),
                },
            })
        })
        .collect()
}

pub(crate) fn injection_consumed_definition_ids(
    relations: &[StaticIndexRelation],
) -> BTreeSet<String> {
    relations
        .iter()
        .filter(|relation| {
            matches!(
                relation.r#type.as_str(),
                "prompt.uses_context"
                    | "prompt.uses_injectable"
                    | "context.uses_context"
                    | "context.uses_injectable"
                    | "injectable.uses_context"
            )
        })
        .map(|relation| relation.to.clone())
        .collect()
}

pub(crate) fn contribution_source<'a>(
    contribution: &Value,
    by_id: &BTreeMap<&'a str, &'a StaticIndexDefinition>,
) -> Option<&'a StaticIndexDefinition> {
    contribution
        .get("sourceDefinitionId")
        .and_then(Value::as_str)
        .and_then(|id| by_id.get(id).copied())
}

pub(crate) fn related_ids(
    owner: &StaticIndexDefinition,
    source: Option<&StaticIndexDefinition>,
) -> Vec<String> {
    let mut ids = vec![owner.id.clone()];
    if let Some(source) = source {
        if source.id != owner.id {
            ids.push(source.id.clone());
        }
    }
    ids
}

pub(crate) fn related_ids_pair(
    owner: &StaticIndexDefinition,
    left: Option<&StaticIndexDefinition>,
    right: Option<&StaticIndexDefinition>,
) -> Vec<String> {
    let mut ids = related_ids(owner, left);
    if let Some(right) = right {
        if !ids.contains(&right.id) {
            ids.push(right.id.clone());
        }
    }
    ids
}

pub(crate) fn injected_source_label(source: Option<&StaticIndexDefinition>) -> String {
    source
        .map(|source| format!("{} \"{}\"", source.kind, source.name))
        .unwrap_or_else(|| "input".to_string())
}

pub(crate) fn tool_label(contribution: &Value) -> &str {
    contribution
        .get("name")
        .or_else(|| contribution.get("variable"))
        .and_then(Value::as_str)
        .unwrap_or("tools")
}

pub(crate) fn source_id_or_index(contribution: &Value, index: usize) -> String {
    contribution
        .get("sourceDefinitionId")
        .and_then(Value::as_str)
        .map(str::to_string)
        .unwrap_or_else(|| index.to_string())
}

pub(crate) fn entry_message(
    definition: &StaticIndexDefinition,
    rule_id: &str,
    variable: Option<&str>,
) -> String {
    let suffix = variable
        .map(|variable| format!(" \"{variable}\""))
        .unwrap_or_default();
    if rule_id == "injection.unresolved_target" {
        return format!(
            "{} \"{}\" has an unresolved injection target{}.",
            definition.kind, definition.name, suffix
        );
    }
    format!(
        "{} \"{}\" has a runtime-dependent injection dependency{}.",
        definition.kind, definition.name, suffix
    )
}
