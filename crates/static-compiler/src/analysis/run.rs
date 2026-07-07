use std::collections::{HashMap, HashSet};

use rayon::prelude::*;
use serde_json::Value;

use crate::{
    analysis::groups::{
        group_from_value, grouped_finalize_facts_from_extracted, primary_definition_id,
    },
    analysis::parse::{ParsedAnalyzeFile, parsed_analyze_file, primary_analyze_files},
    core::facts::StaticIndexPatchFacts,
    core::scoped_definitions::scoped_definitions_by_variable,
    primitives::projection::project_static_syntax_record_with_records,
    protocol::StaticSyntaxFileRecord,
    protocol::static_index::StaticIndexAnalyzeRequest,
    source::groups::grouped_source_facts,
    source::tree_paths::grouped_tree_path_definition_facts,
};

/// Typed fact groups emitted by Static Index analysis before wire serialization.
#[derive(Debug, Clone, Default, PartialEq)]
pub(crate) struct StaticIndexAnalysisFacts {
    groups: Vec<StaticIndexPatchFacts>,
}

impl StaticIndexAnalysisFacts {
    pub(crate) fn new(groups: Vec<StaticIndexPatchFacts>) -> Self {
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
) -> Vec<StaticIndexPatchFacts> {
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
            .filter(|import| import.import_kind.as_deref() != Some("type"))
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

impl From<Vec<StaticIndexPatchFacts>> for StaticIndexAnalysisFacts {
    fn from(groups: Vec<StaticIndexPatchFacts>) -> Self {
        Self::new(groups)
    }
}
