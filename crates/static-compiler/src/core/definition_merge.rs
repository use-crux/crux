//! Definition merge behavior for native static finalization.
//!
//! This mirrors the TypeScript compiler's `mergeDefinitionsById` contract:
//! one row per definition id, with higher-fidelity core fields and later
//! optional overlay fields preserved.

use std::collections::BTreeMap;

use serde_json::{Map, Value};

use crate::core::facts::{
    NativeStaticDefinition, NativeStaticFidelity, NativeStaticProjectSourceRef,
};

/// Merges duplicate Project Index definitions by stable definition id.
pub(crate) fn merge_definitions_by_id(
    definitions: Vec<NativeStaticDefinition>,
) -> Vec<NativeStaticDefinition> {
    let mut merged = BTreeMap::<String, NativeStaticDefinition>::new();
    for definition in definitions {
        match merged.remove(&definition.id) {
            Some(existing) => {
                merged.insert(
                    definition.id.clone(),
                    merge_definition(existing, definition),
                );
            }
            None => {
                merged.insert(definition.id.clone(), definition);
            }
        }
    }
    merged.into_values().collect()
}

fn merge_definition(
    existing: NativeStaticDefinition,
    incoming: NativeStaticDefinition,
) -> NativeStaticDefinition {
    let keep_existing_core = fidelity_rank(existing.fidelity) >= fidelity_rank(incoming.fidelity);
    let metadata = if keep_existing_core {
        merge_metadata(incoming.metadata.as_ref(), existing.metadata.as_ref())
    } else {
        merge_metadata(existing.metadata.as_ref(), incoming.metadata.as_ref())
    };
    let mut merged = if keep_existing_core {
        existing.clone()
    } else {
        incoming.clone()
    };

    merged.source = incoming.source.clone().or(existing.source.clone());
    merged.source_snippet = incoming
        .source_snippet
        .clone()
        .or(existing.source_snippet.clone());
    merged.description = incoming
        .description
        .clone()
        .or(existing.description.clone());
    merged.tags = if incoming.tags.is_empty() {
        existing.tags.clone()
    } else {
        incoming.tags.clone()
    };
    merged.path = if incoming.path.is_empty() {
        existing.path.clone()
    } else {
        incoming.path.clone()
    };
    merged.fidelity = if keep_existing_core {
        existing.fidelity
    } else {
        incoming.fidelity
    };
    merged.status = incoming.status.clone().or(existing.status.clone());
    merged.fingerprint = incoming
        .fingerprint
        .clone()
        .or(existing.fingerprint.clone());
    merged.metadata = metadata;
    merged.quality = incoming.quality.clone().or(existing.quality.clone());
    merged.source_refs = merge_source_refs(existing.source_refs, incoming.source_refs);
    merged
}

fn merge_metadata(base: Option<&Value>, overlay: Option<&Value>) -> Option<Value> {
    let mut metadata = Map::<String, Value>::new();
    extend_object(&mut metadata, base);
    extend_object(&mut metadata, overlay);

    let base_facts = base.and_then(|value| value.get("facts"));
    let overlay_facts = overlay.and_then(|value| value.get("facts"));
    if base_facts.is_some_and(Value::is_object) || overlay_facts.is_some_and(Value::is_object) {
        metadata.insert(
            "facts".to_string(),
            Value::Object(merge_facts(base_facts, overlay_facts)),
        );
    }

    if metadata.is_empty() {
        None
    } else {
        Some(Value::Object(metadata))
    }
}

fn merge_facts(base: Option<&Value>, overlay: Option<&Value>) -> Map<String, Value> {
    let mut facts = Map::<String, Value>::new();
    extend_object(&mut facts, base);
    extend_object(&mut facts, overlay);

    let use_entries = merge_list(
        base.and_then(|value| value.get("useEntries")),
        overlay.and_then(|value| value.get("useEntries")),
    );
    if let Some(use_entries) = use_entries {
        facts.insert("useEntries".to_string(), Value::Array(use_entries));
    }
    facts
}

fn extend_object(target: &mut Map<String, Value>, value: Option<&Value>) {
    let Some(object) = value.and_then(Value::as_object) else {
        return;
    };
    for (key, value) in object {
        target.insert(key.clone(), value.clone());
    }
}

fn merge_list(base: Option<&Value>, overlay: Option<&Value>) -> Option<Vec<Value>> {
    let items: Vec<Value> = base
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .chain(overlay.and_then(Value::as_array).into_iter().flatten())
        .cloned()
        .collect();
    if items.is_empty() { None } else { Some(items) }
}

fn merge_source_refs(
    existing: Vec<NativeStaticProjectSourceRef>,
    incoming: Vec<NativeStaticProjectSourceRef>,
) -> Vec<NativeStaticProjectSourceRef> {
    let mut refs: Vec<NativeStaticProjectSourceRef> = Vec::new();
    for ref_ in existing.into_iter().chain(incoming) {
        if let Some(index) = refs.iter().position(|current| current.id == ref_.id) {
            refs[index] = ref_;
        } else {
            refs.push(ref_);
        }
    }
    refs
}

fn fidelity_rank(fidelity: NativeStaticFidelity) -> u8 {
    match fidelity {
        NativeStaticFidelity::Resolved => 3,
        NativeStaticFidelity::Partial => 2,
        NativeStaticFidelity::Error => 1,
    }
}
