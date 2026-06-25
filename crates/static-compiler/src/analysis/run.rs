use std::collections::{HashMap, HashSet};

use rayon::prelude::*;
use serde_json::{Map, Value};

use crate::{
    analysis::parse::{ParsedAnalyzeFile, parsed_analyze_file, primary_analyze_files},
    core::facts::StaticIndexIndexPatchFacts,
    core::scoped_definitions::{ScopedDefinition, scoped_definitions_by_variable},
    primitives::projection::project_static_syntax_record_with_records,
    protocol::StaticSyntaxFileRecord,
    protocol::static_index::StaticIndexAnalyzeRequest,
    source::groups::grouped_source_facts,
    source::tree_paths::grouped_tree_path_definition_facts,
};

/// Typed fact groups emitted by Static Index analysis before wire serialization.
#[derive(Debug, Clone, Default, PartialEq)]
pub(crate) struct StaticIndexAnalysisFacts {
    groups: Vec<StaticIndexIndexPatchFacts>,
}

impl StaticIndexAnalysisFacts {
    pub(crate) fn new(groups: Vec<StaticIndexIndexPatchFacts>) -> Self {
        Self { groups }
    }

    #[cfg(test)]
    pub(crate) fn is_empty(&self) -> bool {
        self.groups.is_empty()
    }

    pub(crate) fn into_wire_values(self) -> Vec<Value> {
        self.groups
            .into_iter()
            .filter_map(|group| serde_json::to_value(group).ok())
            .collect()
    }
}

pub(crate) fn analyze_static_index_facts(
    request: &StaticIndexAnalyzeRequest,
) -> StaticIndexAnalysisFacts {
    let parsed_files = request
        .files
        .par_iter()
        .enumerate()
        .filter_map(|(index, file)| {
            parsed_analyze_file(request, file)
                .ok()
                .map(|parsed| (index, parsed))
        })
        .collect::<Vec<_>>();
    let records_by_file = parsed_files
        .iter()
        .map(|(_, file)| (file.record.file.clone(), file.record.clone()))
        .collect::<HashMap<_, _>>();
    let primary_files = primary_analyze_files(request);
    let mut analyzed = parsed_files
        .par_iter()
        .filter(|(_, file)| primary_files.contains(&file.record.file))
        .map(|(index, file)| (*index, analyze_parsed_file(request, file, &records_by_file)))
        .collect::<Vec<_>>();
    analyzed.sort_by_key(|(index, _)| *index);
    analyzed
        .into_iter()
        .flat_map(|(_, groups)| groups)
        .collect::<Vec<_>>()
        .into()
}

fn analyze_parsed_file(
    request: &StaticIndexAnalyzeRequest,
    parsed: &ParsedAnalyzeFile,
    records_by_file: &HashMap<String, StaticSyntaxFileRecord>,
) -> Vec<StaticIndexIndexPatchFacts> {
    let native_facts = project_static_syntax_record_with_records(
        &parsed.record,
        &parsed.source_text,
        Some(records_by_file),
    );
    let scoped_definitions =
        scoped_definitions_by_variable(&parsed.record, &native_facts, records_by_file);
    let mut seen_definition_ids = HashSet::<String>::new();
    let mut groups = Vec::new();
    for projection in &native_facts {
        let Some(grouped) = grouped_finalize_facts_from_extracted(
            &projection.facts,
            &request.plan.root,
            request.plan.project_name.as_deref(),
            &scoped_definitions,
        ) else {
            continue;
        };
        if let Some(id) = primary_definition_id(&grouped) {
            if !seen_definition_ids.insert(id) {
                continue;
            }
        }
        groups.push(grouped);
    }
    if let Some(tree_paths) = grouped_tree_path_definition_facts(
        &request.plan.root,
        request.plan.project_name.as_deref(),
        &parsed.record,
        &native_facts,
        records_by_file,
    )
    .and_then(group_from_value)
    {
        groups.push(tree_paths);
    }
    if let Some(source_group) = grouped_source_facts(
        &request.plan.root,
        request.plan.project_name.as_deref(),
        &parsed.record.file,
        parsed
            .record
            .imports
            .iter()
            .filter_map(|import| import.resolved_file.clone())
            .collect(),
        !groups.is_empty(),
    )
    .and_then(group_from_value)
    {
        groups.push(source_group);
    }
    groups
}

impl From<Vec<StaticIndexIndexPatchFacts>> for StaticIndexAnalysisFacts {
    fn from(groups: Vec<StaticIndexIndexPatchFacts>) -> Self {
        Self::new(groups)
    }
}

fn primary_definition_id(grouped: &StaticIndexIndexPatchFacts) -> Option<String> {
    grouped
        .definitions
        .first()
        .map(|definition| definition.id.clone())
}

fn grouped_finalize_facts_from_extracted(
    extracted: &Value,
    root: &str,
    project_name: Option<&str>,
    scoped_definitions: &HashMap<String, ScopedDefinition>,
) -> Option<StaticIndexIndexPatchFacts> {
    let definition_entries = extracted
        .get("definitions")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let mut definitions = Vec::new();
    let owner = append_definitions(&mut definitions, &definition_entries);
    let relation_refs = owner
        .as_ref()
        .map(|owner| {
            relation_refs(
                &owner.id,
                owner.source.as_ref(),
                extracted,
                scoped_definitions,
            )
        })
        .unwrap_or_default();
    let source_refs = array_values(extracted, "sourceRefs");
    let diagnostics = array_values(extracted, "diagnostics");

    if definitions.is_empty()
        && relation_refs.is_empty()
        && source_refs.is_empty()
        && diagnostics.is_empty()
    {
        return None;
    }

    let mut grouped = Map::new();
    grouped.insert("root".to_string(), Value::String(root.to_string()));
    if let Some(project_name) = project_name {
        grouped.insert(
            "projectName".to_string(),
            Value::String(project_name.to_string()),
        );
    }
    insert_array(&mut grouped, "definitions", definitions);
    insert_array(&mut grouped, "relationRefs", relation_refs);
    insert_array(&mut grouped, "sourceRefs", source_refs);
    insert_array(&mut grouped, "diagnostics", diagnostics);
    group_from_value(Value::Object(grouped))
}

fn group_from_value(value: Value) -> Option<StaticIndexIndexPatchFacts> {
    serde_json::from_value::<StaticIndexIndexPatchFacts>(value).ok()
}

struct OwnerDefinition {
    id: String,
    source: Option<Value>,
}

fn append_definitions(definitions: &mut Vec<Value>, entries: &[Value]) -> Option<OwnerDefinition> {
    let primary = entries.first()?;
    let primary_definition = primary.get("definition")?.clone();
    let owner_definition_id = primary_definition
        .get("id")
        .and_then(Value::as_str)
        .map(str::to_string);
    let owner_source = primary_definition.get("source").cloned();
    definitions.push(primary_definition);
    for entry in entries.iter().skip(1) {
        if let Some(definition) = entry.get("definition") {
            definitions.push(definition.clone());
        }
    }
    definitions.extend(array_values(primary, "extraDefinitions"));
    owner_definition_id.map(|id| OwnerDefinition {
        id,
        source: owner_source,
    })
}

fn relation_refs(
    owner_definition_id: &str,
    default_source: Option<&Value>,
    extracted: &Value,
    scoped_definitions: &HashMap<String, ScopedDefinition>,
) -> Vec<Value> {
    array_values(extracted, "references")
        .into_iter()
        .filter_map(|reference| {
            relation_ref(
                owner_definition_id,
                default_source,
                &reference,
                scoped_definitions,
            )
        })
        .collect()
}

fn relation_ref(
    owner_definition_id: &str,
    default_source: Option<&Value>,
    reference: &Value,
    scoped_definitions: &HashMap<String, ScopedDefinition>,
) -> Option<Value> {
    let relation_type = reference.get("type").and_then(Value::as_str)?;
    let from_id = reference.get("fromId").and_then(Value::as_str);
    let from_variable = reference.get("fromVariable").and_then(Value::as_str);
    let to_variable = reference.get("toVariable").and_then(Value::as_str);
    let scoped_target = to_variable.and_then(|variable| scoped_definitions.get(variable));
    let scoped_source = from_variable.and_then(|variable| scoped_definitions.get(variable));
    let to_id = reference
        .get("toId")
        .and_then(Value::as_str)
        .or_else(|| scoped_target.map(|definition| definition.id.as_str()));
    let from_id = from_id.or_else(|| scoped_source.map(|definition| definition.id.as_str()));
    let fallback_to_id = reference.get("fallbackToId").and_then(Value::as_str);
    let type_by_target_kind = reference.get("typeByTargetKind");
    let source = reference.get("source").or(default_source);
    let mut value = Map::new();
    value.insert(
        "ownerDefinitionId".to_string(),
        Value::String(owner_definition_id.to_string()),
    );
    value.insert("type".to_string(), Value::String(relation_type.to_string()));
    insert_optional_string(&mut value, "fromId", from_id);
    insert_optional_string(&mut value, "fromVariable", from_variable);
    insert_optional_string(&mut value, "toId", to_id);
    insert_optional_string(&mut value, "toVariable", to_variable);
    insert_optional_string(&mut value, "fallbackToId", fallback_to_id);
    if type_by_target_kind.is_some_and(|item| !item.is_null()) {
        value.insert(
            "typeByTargetKind".to_string(),
            type_by_target_kind.cloned().unwrap_or(Value::Null),
        );
    }
    if source.is_some_and(|item| !item.is_null()) {
        value.insert("source".to_string(), source.cloned().unwrap_or(Value::Null));
    }
    Some(Value::Object(value))
}

fn array_values(value: &Value, key: &str) -> Vec<Value> {
    value
        .get(key)
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default()
}

fn insert_array(grouped: &mut Map<String, Value>, key: &str, values: Vec<Value>) {
    if !values.is_empty() {
        grouped.insert(key.to_string(), Value::Array(values));
    }
}

fn insert_optional_string(grouped: &mut Map<String, Value>, key: &str, value: Option<&str>) {
    if let Some(value) = value {
        grouped.insert(key.to_string(), Value::String(value.to_string()));
    }
}
