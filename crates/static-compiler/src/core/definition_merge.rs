//! Definition merge behavior for Static Index finalization.
//!
//! This mirrors the TypeScript compiler's `mergeDefinitionsById` contract:
//! one row per definition id, with higher-fidelity core fields and later
//! optional overlay fields preserved.

use std::collections::BTreeMap;

use serde_json::{Map, Value};

use crate::core::facts::{StaticIndexDefinition, StaticIndexFidelity, StaticIndexProjectSourceRef};

/// Merges duplicate Project Index definitions by stable definition id.
pub(crate) fn merge_definitions_by_id(
    definitions: Vec<StaticIndexDefinition>,
) -> Vec<StaticIndexDefinition> {
    let mut merged = BTreeMap::<String, StaticIndexDefinition>::new();
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
    existing: StaticIndexDefinition,
    incoming: StaticIndexDefinition,
) -> StaticIndexDefinition {
    let retains_thread_definitions = existing.kind == "thread"
        && incoming.kind == "thread"
        && existing.source != incoming.source;
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
    merged.source_refs =
        merge_source_refs(existing.source_refs.clone(), incoming.source_refs.clone());
    if retains_thread_definitions {
        append_thread_definition_ref(&mut merged.source_refs, &existing);
        append_thread_definition_ref(&mut merged.source_refs, &incoming);
    }
    merged
}

fn append_thread_definition_ref(
    source_refs: &mut Vec<StaticIndexProjectSourceRef>,
    definition: &StaticIndexDefinition,
) {
    if definition.status.as_deref() != Some("active") {
        return;
    }
    let Some(source) = definition.source.as_ref() else {
        return;
    };
    if source_refs
        .iter()
        .any(|source_ref| source_ref.role == "definition" && source_ref.source == *source)
    {
        return;
    }
    if let Some(source_ref) = thread_definition_source_ref(definition) {
        source_refs.push(source_ref);
    }
}

fn thread_definition_source_ref(
    definition: &StaticIndexDefinition,
) -> Option<StaticIndexProjectSourceRef> {
    let source = definition.source.clone()?;
    let identity = definition.fingerprint.clone().unwrap_or_else(|| {
        format!(
            "{}:{}:{}",
            source.file,
            source.line,
            source.column.unwrap_or_default()
        )
    });
    Some(StaticIndexProjectSourceRef {
        id: format!("source-ref:thread-definition:{}:{identity}", definition.id),
        role: "definition".to_string(),
        property: None,
        symbol: definition
            .metadata
            .as_ref()
            .and_then(|metadata| metadata.get("exportName"))
            .and_then(Value::as_str)
            .map(str::to_string),
        source,
        snippet: definition.source_snippet.clone(),
        fidelity: definition.fidelity,
        description: Some("Authored Thread definition".to_string()),
        metadata: None,
    })
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
    existing: Vec<StaticIndexProjectSourceRef>,
    incoming: Vec<StaticIndexProjectSourceRef>,
) -> Vec<StaticIndexProjectSourceRef> {
    let mut refs: Vec<StaticIndexProjectSourceRef> = Vec::new();
    for ref_ in existing.into_iter().chain(incoming) {
        if let Some(index) = refs.iter().position(|current| current.id == ref_.id) {
            refs[index] = ref_;
        } else {
            refs.push(ref_);
        }
    }
    refs
}

fn fidelity_rank(fidelity: StaticIndexFidelity) -> u8 {
    match fidelity {
        StaticIndexFidelity::Resolved => 3,
        StaticIndexFidelity::Partial => 2,
        StaticIndexFidelity::Error => 1,
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::merge_definitions_by_id;
    use crate::core::facts::StaticIndexDefinition;

    #[test]
    fn duplicate_threads_retain_each_authored_definition_source() {
        let definitions: Vec<StaticIndexDefinition> = serde_json::from_value(json!([
            {
                "id": "thread:conversation",
                "kind": "thread",
                "name": "conversation",
                "source": { "file": "src/a.ts", "line": 3 },
                "fidelity": "resolved",
                "status": "active",
                "fingerprint": "first",
                "metadata": { "exportName": "conversation" }
            },
            {
                "id": "thread:conversation",
                "kind": "thread",
                "name": "conversation",
                "source": { "file": "src/b.ts", "line": 7 },
                "fidelity": "resolved",
                "status": "active",
                "fingerprint": "second",
                "metadata": { "exportName": "duplicateConversation" }
            },
            {
                "id": "thread:conversation",
                "kind": "thread",
                "name": "conversation",
                "source": { "file": "src/a.ts", "line": 3 },
                "fidelity": "resolved",
                "status": "active",
                "fingerprint": "first",
                "metadata": { "exportName": "duplicateConversation" }
            }
        ]))
        .expect("definitions decode");

        let merged = merge_definitions_by_id(definitions);
        let refs = &merged[0].source_refs;
        assert_eq!(refs.len(), 2);
        assert_eq!(refs[0].role, "definition");
        assert_eq!(refs[0].symbol.as_deref(), Some("conversation"));
        assert_eq!(refs[0].source.file, "src/a.ts");
        assert_eq!(refs[1].symbol.as_deref(), Some("duplicateConversation"));
        assert_eq!(refs[1].source.file, "src/b.ts");
    }

    #[test]
    fn inactive_thread_duplicates_do_not_become_active_occurrence_refs() {
        let definitions: Vec<StaticIndexDefinition> = serde_json::from_value(json!([
            {
                "id": "thread:conversation",
                "kind": "thread",
                "name": "conversation",
                "source": { "file": "src/active.ts", "line": 3 },
                "fidelity": "resolved",
                "status": "active",
                "metadata": { "exportName": "conversation" }
            },
            {
                "id": "thread:conversation",
                "kind": "thread",
                "name": "conversation",
                "source": { "file": "src/inactive.ts", "line": 3 },
                "fidelity": "resolved",
                "status": "inactive",
                "metadata": { "exportName": "legacyConversation" }
            }
        ]))
        .expect("definitions decode");

        let merged = merge_definitions_by_id(definitions);
        assert_eq!(merged[0].source_refs.len(), 1);
        assert_eq!(merged[0].source_refs[0].source.file, "src/active.ts");
    }
}
