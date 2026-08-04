//! Built-in Effect lint rules backed by explicit Project Index evidence.

use serde_json::{Value, json};

use crate::builder::{StaticIndexLintBuilder, StaticIndexLintFindingInput, definition_evidence};
use crate::facts::{
    StaticIndexDefinition, StaticIndexLintFinding, StaticIndexPatchFacts,
    StaticIndexProjectSourceRef,
};

const REQUIRED_BOUNDARY_PROPERTY: &str = "rollbackOnError.recovery";

pub(crate) fn irreversible_required_boundary_findings(
    builder: &StaticIndexLintBuilder,
    facts: &StaticIndexPatchFacts,
) -> Vec<StaticIndexLintFinding> {
    facts
        .definitions
        .iter()
        .filter(|definition| explicitly_irreversible(definition))
        .flat_map(|definition| {
            let mut boundary_refs = definition
                .source_refs
                .iter()
                .chain(
                    facts
                        .source_refs
                        .iter()
                        .filter(|source_ref| source_ref.definition_id == definition.id)
                        .map(|source_ref| &source_ref.ref_),
                )
                .filter(|source_ref| required_boundary_evidence(source_ref))
                .collect::<Vec<_>>();
            boundary_refs.sort_by(|left, right| left.id.cmp(&right.id));
            boundary_refs.dedup_by(|left, right| left.id == right.id);
            boundary_refs
                .into_iter()
                .filter_map(|source_ref| finding(builder, definition, source_ref))
                .collect::<Vec<_>>()
        })
        .collect()
}

pub(crate) fn recovery_not_runtime_addressable_findings(
    builder: &StaticIndexLintBuilder,
    facts: &StaticIndexPatchFacts,
    runtime_configured: Option<bool>,
) -> Vec<StaticIndexLintFinding> {
    if runtime_configured != Some(true) {
        return Vec::new();
    }
    facts
        .definitions
        .iter()
        .filter(|definition| {
            recoverable_but_not_exported(definition)
                && has_statically_visible_durable_usage(facts, definition)
        })
        .filter_map(|definition| {
            let facts = effect_facts(definition)?;
            let effect_id = facts.get("effectId")?.as_str()?;
            let version = facts.get("version")?.as_f64()?;
            if !version.is_finite() {
                return None;
            }
            builder.finding(StaticIndexLintFindingInput {
                rule_id: "effect.recovery_not_runtime_addressable",
                key: definition.id.as_str(),
                message: format!(
                    "Recoverable Effect \"{effect_id}\" version {version} is not exported. Export the definition so the Runtime program can address recovery after restart."
                ),
                source: definition.source.as_ref(),
                primary_definition_id: Some(definition.id.as_str()),
                related_definition_ids: vec![definition.id.clone()],
                evidence: vec![definition_evidence(
                    definition,
                    "Recoverable Effect is not a Runtime-addressable export",
                )],
                fixes: Vec::new(),
            })
        })
        .collect()
}

fn has_statically_visible_durable_usage(
    facts: &StaticIndexPatchFacts,
    definition: &StaticIndexDefinition,
) -> bool {
    definition
        .source_refs
        .iter()
        .chain(
            facts
                .source_refs
                .iter()
                .filter(|source_ref| source_ref.definition_id == definition.id)
                .map(|source_ref| &source_ref.ref_),
        )
        .any(required_boundary_evidence)
}

fn explicitly_irreversible(definition: &StaticIndexDefinition) -> bool {
    definition.kind == "effect"
        && effect_facts(definition)
            .and_then(|facts| facts.get("recoverable"))
            .and_then(Value::as_bool)
            == Some(false)
}

fn recoverable_but_not_exported(definition: &StaticIndexDefinition) -> bool {
    definition.kind == "effect"
        && effect_facts(definition)
            .and_then(|facts| facts.get("recoverable"))
            .and_then(Value::as_bool)
            == Some(true)
        && definition
            .metadata
            .as_ref()
            .and_then(Value::as_object)
            .and_then(|metadata| metadata.get("exported"))
            .and_then(Value::as_bool)
            != Some(true)
}

fn required_boundary_evidence(source_ref: &StaticIndexProjectSourceRef) -> bool {
    source_ref.role == "config"
        && source_ref.property.as_deref() == Some(REQUIRED_BOUNDARY_PROPERTY)
        && source_ref.fidelity == crate::facts::StaticIndexFidelity::Resolved
}

fn finding(
    builder: &StaticIndexLintBuilder,
    definition: &StaticIndexDefinition,
    source_ref: &StaticIndexProjectSourceRef,
) -> Option<StaticIndexLintFinding> {
    let facts = effect_facts(definition)?;
    let effect_id = facts.get("effectId")?.as_str()?;
    let location = format!("{}:{}", source_ref.source.file, source_ref.source.line);
    let key = format!("{}:{}", definition.id, source_ref.id);
    builder.finding(StaticIndexLintFindingInput {
        rule_id: "effect.irreversible_in_required_boundary",
        key: &key,
        message: format!(
            "Irreversible Effect \"{effect_id}\" is called inside the required-recovery boundary at {location}. Define recovery, move the Effect outside the boundary, or choose {{ recovery: 'best-effort' }}."
        ),
        source: Some(&source_ref.source),
        primary_definition_id: Some(definition.id.as_str()),
        related_definition_ids: vec![definition.id.clone()],
        evidence: vec![
            definition_evidence(definition, "Effect is explicitly irreversible"),
            json!({
                "kind": "source",
                "label": "Required-recovery boundary contains this Effect call",
                "source": source_ref.source,
                "data": {
                    "definitionId": definition.id,
                    "effectId": effect_id,
                    "boundary": "rollbackOnError",
                    "recovery": "required",
                },
            }),
        ],
        fixes: Vec::new(),
    })
}

fn effect_facts(definition: &StaticIndexDefinition) -> Option<&serde_json::Map<String, Value>> {
    definition
        .metadata
        .as_ref()?
        .as_object()?
        .get("facts")?
        .as_object()
}
