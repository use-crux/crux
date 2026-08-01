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

fn explicitly_irreversible(definition: &StaticIndexDefinition) -> bool {
    definition.kind == "effect"
        && effect_facts(definition)
            .and_then(|facts| facts.get("recoverable"))
            .and_then(Value::as_bool)
            == Some(false)
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
