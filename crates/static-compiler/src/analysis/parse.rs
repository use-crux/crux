//! Parse-stage helpers for Static Index analysis.

use std::collections::HashSet;

use crate::{
    compat::static_syntax::parse_static_syntax_record,
    protocol::static_index::{StaticIndexAnalyzeFile, StaticIndexAnalyzeRequest},
    protocol::{ParseRequest, StaticSyntaxFileRecord},
};

pub(crate) struct ParsedAnalyzeFile {
    pub(crate) source_text: String,
    pub(crate) record: StaticSyntaxFileRecord,
}

pub(crate) fn parsed_analyze_file(
    request: &StaticIndexAnalyzeRequest,
    file: &StaticIndexAnalyzeFile,
) -> Result<ParsedAnalyzeFile, String> {
    let Some(source) = file.source_text.clone() else {
        return Err("missing source text".to_string());
    };
    let record = parse_static_syntax_record(ParseRequest {
        root: request.plan.root.clone(),
        file: file.file.clone(),
        source: source.clone(),
        call_names: request.plan.call_names.clone(),
        call_interests: request.plan.call_interests.clone(),
        constructor_names: request.plan.constructor_names.clone(),
        constructor_interests: request.plan.constructor_interests.clone(),
        prune_native_fact_call_names: Vec::new(),
    })?;
    Ok(ParsedAnalyzeFile {
        source_text: source,
        record,
    })
}

pub(crate) fn primary_analyze_files(request: &StaticIndexAnalyzeRequest) -> HashSet<String> {
    let primary_files = request
        .plan
        .primary_files
        .as_ref()
        .unwrap_or(&request.plan.files);
    primary_files
        .iter()
        .map(|file| file.file.clone())
        .collect::<HashSet<_>>()
}
