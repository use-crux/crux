//! Pure Oxc syntax frontend.
//!
//! This module turns TypeScript source text into static syntax evidence only.
//! Native static primitive projection happens later in downstream compiler
//! and extractor code.

use std::collections::HashMap;

use oxc_allocator::Allocator;
use oxc_parser::Parser;
use oxc_span::SourceType;

use crate::{
    FRONTEND_NAME, FRONTEND_VERSION,
    protocol::{
        IndexDiagnostic, ParseRequest, StaticSyntaxFileRecord, StaticSyntaxFrontendIdentity,
    },
    syntax::imports::collect_import_records,
    syntax::initializers::collect_local_initializers,
    syntax::match_interests::CalleeMatcher,
    syntax::match_statements::collect_matches,
    syntax::source::{SourceView, sha256},
};

/// Parse source text into backend-neutral syntax evidence.
///
/// The returned record intentionally contains no `native_facts`. Callers that
/// need Project Index facts must invoke the native static projection pipeline
/// explicitly after parsing.
pub fn parse_source(input: ParseRequest) -> Result<StaticSyntaxFileRecord, String> {
    let allocator = Allocator::default();
    let source_type = SourceType::from_path(&input.file)
        .unwrap_or_default()
        .with_module(true);
    let parsed = Parser::new(&allocator, &input.source, source_type).parse();
    let view = SourceView::new(&input.file, &input.source);
    let imports = collect_import_records(&input.root, &input.file, &parsed.program.body, &view);
    let imports_by_local_name = imports
        .iter()
        .map(|item| (item.local_name.clone(), item.clone()))
        .collect::<HashMap<_, _>>();
    let call_matcher = CalleeMatcher::for_calls(input.call_names, input.call_interests);
    let constructor_matcher = CalleeMatcher::for_constructors(
        input.constructor_names,
        input.constructor_interests,
        vec!["Agent".to_string()],
    );
    let matches = collect_matches(
        &input.root,
        &input.file,
        &view,
        &parsed.program.body,
        &imports_by_local_name,
        &call_matcher,
        &constructor_matcher,
    );
    let local_initializers =
        collect_local_initializers(&view, &parsed.program.body, &imports_by_local_name);

    Ok(StaticSyntaxFileRecord {
        schema_version: 1,
        frontend: StaticSyntaxFrontendIdentity {
            name: FRONTEND_NAME.to_string(),
            version: FRONTEND_VERSION.to_string(),
        },
        file: input.file.clone(),
        source_hash: sha256(&input.source),
        imports,
        matches,
        native_facts: Vec::new(),
        local_initializers,
        diagnostics: parsed
            .errors
            .into_iter()
            .enumerate()
            .map(|(index, error)| IndexDiagnostic {
                id: format!("syntax:{}:{index}", input.file),
                severity: "error".to_string(),
                code: "index.syntax_parse".to_string(),
                message: error.to_string(),
                source: view.location_for_offset(0),
            })
            .collect(),
    })
}
