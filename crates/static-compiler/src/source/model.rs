//! Source row and source-ref projection for Static Index finalization.

use std::collections::{BTreeMap, BTreeSet};

use crate::core::facts::{
    StaticIndexDefinition, StaticIndexDiagnosticSeverity, StaticIndexPatchFacts,
    StaticIndexProjectSourceRef, StaticIndexSourceGraph, StaticIndexSourceGraphShard,
    StaticIndexSourceRow,
};

/// Projects source-ref facts and source graph rows into the AST patch shape.
pub(crate) fn with_static_index_source_model(
    mut facts: StaticIndexPatchFacts,
) -> StaticIndexPatchFacts {
    fold_source_refs_into_definitions(&mut facts.definitions, &facts.source_refs);
    facts.sources = source_rows(&facts);
    if facts.source_graph.is_none() && !facts.sources.is_empty() {
        facts.source_graph = Some(static_index_source_graph());
    }
    facts.canonicalize();
    facts
}

fn fold_source_refs_into_definitions(
    definitions: &mut [StaticIndexDefinition],
    source_refs: &[crate::core::facts::StaticIndexSourceRefFact],
) {
    let mut refs_by_definition = BTreeMap::<String, Vec<StaticIndexProjectSourceRef>>::new();
    for fact in source_refs {
        refs_by_definition
            .entry(fact.definition_id.clone())
            .or_default()
            .push(fact.ref_.clone());
    }
    for definition in definitions {
        let Some(refs) = refs_by_definition.remove(&definition.id) else {
            continue;
        };
        definition.source_refs = merge_source_refs(&definition.source_refs, &refs);
    }
}

fn source_rows(facts: &StaticIndexPatchFacts) -> Vec<StaticIndexSourceRow> {
    let mut rows = BTreeMap::<String, StaticIndexSourceRow>::new();
    for source in &facts.sources {
        merge_source_row(&mut rows, source.clone());
    }
    for definition in &facts.definitions {
        if let Some(file) = definition.source.as_ref().map(|source| source.file.clone()) {
            let row = ensure_source_row(&mut rows, &file, "indexed");
            row.definition_ids =
                sorted_strings([row.definition_ids.clone(), vec![definition.id.clone()]].concat());
        }
    }
    for diagnostic in &facts.diagnostics {
        if let Some(file) = diagnostic.source.as_ref().map(|source| source.file.clone()) {
            let status = match diagnostic.severity {
                StaticIndexDiagnosticSeverity::Error => "error",
                _ => "partial",
            };
            let row = ensure_source_row(&mut rows, &file, status);
            row.diagnostics =
                sorted_strings([row.diagnostics.clone(), vec![diagnostic.id.clone()]].concat());
        }
    }
    let dependencies: Vec<(String, String)> = rows
        .values()
        .flat_map(source_dependencies)
        .chain(source_ref_dependencies(&facts.definitions))
        .collect();
    for (file, dependency) in dependencies {
        {
            let row = ensure_source_row(&mut rows, &dependency, "indexed");
            row.dependents = sorted_strings([row.dependents.clone(), vec![file.clone()]].concat());
        }
        {
            let row = ensure_source_row(&mut rows, &file, "indexed");
            row.dependencies =
                sorted_strings([row.dependencies.clone(), vec![dependency]].concat());
        }
    }
    assign_source_shards(&mut rows, facts.source_graph.as_ref());
    rows.into_values().collect()
}

fn merge_source_row(
    rows: &mut BTreeMap<String, StaticIndexSourceRow>,
    incoming: StaticIndexSourceRow,
) {
    let existing = rows.remove(&incoming.file);
    rows.insert(
        incoming.file.clone(),
        match existing {
            Some(existing) => StaticIndexSourceRow {
                file: incoming.file,
                status: merge_source_status(&existing.status, &incoming.status),
                shard_id: incoming.shard_id.or(existing.shard_id),
                source_hash: incoming.source_hash.or(existing.source_hash),
                interface_hash: incoming.interface_hash.or(existing.interface_hash),
                definition_ids: sorted_strings(
                    [existing.definition_ids, incoming.definition_ids].concat(),
                ),
                dependencies: sorted_strings(
                    [existing.dependencies, incoming.dependencies].concat(),
                ),
                dependents: sorted_strings([existing.dependents, incoming.dependents].concat()),
                diagnostics: sorted_strings([existing.diagnostics, incoming.diagnostics].concat()),
            },
            None => incoming,
        },
    );
}

fn ensure_source_row<'a>(
    rows: &'a mut BTreeMap<String, StaticIndexSourceRow>,
    file: &str,
    status: &str,
) -> &'a mut StaticIndexSourceRow {
    let row = rows
        .entry(file.to_string())
        .or_insert_with(|| StaticIndexSourceRow {
            file: file.to_string(),
            status: status.to_string(),
            shard_id: None,
            source_hash: None,
            interface_hash: None,
            definition_ids: Vec::new(),
            dependencies: Vec::new(),
            dependents: Vec::new(),
            diagnostics: Vec::new(),
        });
    row.status = merge_source_status(&row.status, status);
    row
}

fn source_dependencies(source: &StaticIndexSourceRow) -> Vec<(String, String)> {
    source
        .dependencies
        .iter()
        .map(|dependency| (source.file.clone(), dependency.clone()))
        .collect()
}

fn source_ref_dependencies(definitions: &[StaticIndexDefinition]) -> Vec<(String, String)> {
    definitions
        .iter()
        .flat_map(|definition| {
            let from = definition.source.as_ref().map(|source| source.file.clone());
            definition.source_refs.iter().filter_map(move |ref_| {
                let from = from.clone()?;
                let to = ref_.source.file.clone();
                if to.is_empty() || to == from {
                    None
                } else {
                    Some((from, to))
                }
            })
        })
        .collect()
}

fn assign_source_shards(
    rows: &mut BTreeMap<String, StaticIndexSourceRow>,
    source_graph: Option<&StaticIndexSourceGraph>,
) {
    let Some(shards) = source_graph.and_then(|graph| graph.shards.as_deref()) else {
        return;
    };
    for row in rows.values_mut() {
        if row.shard_id.is_none() {
            row.shard_id = shard_id_for_file(&row.file, shards);
        }
    }
}

fn shard_id_for_file(file: &str, shards: &[StaticIndexSourceGraphShard]) -> Option<String> {
    shards
        .iter()
        .filter(|shard| file == shard.root || file.starts_with(&format!("{}/", shard.root)))
        .max_by_key(|shard| shard.root.len())
        .map(|shard| shard.id.clone())
}

fn merge_source_refs(
    existing: &[StaticIndexProjectSourceRef],
    incoming: &[StaticIndexProjectSourceRef],
) -> Vec<StaticIndexProjectSourceRef> {
    let mut seen = BTreeSet::<String>::new();
    let mut refs = Vec::new();
    for ref_ in existing.iter().chain(incoming.iter()) {
        if seen.insert(ref_.id.clone()) {
            refs.push(ref_.clone());
        }
    }
    refs
}

fn merge_source_status(left: &str, right: &str) -> String {
    if left == "error" || right == "error" {
        return "error".to_string();
    }
    if left == "partial" || right == "partial" {
        return "partial".to_string();
    }
    "indexed".to_string()
}

fn static_index_source_graph() -> StaticIndexSourceGraph {
    StaticIndexSourceGraph {
        schema_version: 1,
        produced_by: "@use-crux/indexer".to_string(),
        capabilities: vec![
            "source-dependencies".to_string(),
            "source-dependents".to_string(),
            "definition-ownership".to_string(),
            "diagnostic-ownership".to_string(),
        ],
        shards: None,
    }
}

fn sorted_strings(values: Vec<String>) -> Vec<String> {
    values
        .into_iter()
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect()
}
