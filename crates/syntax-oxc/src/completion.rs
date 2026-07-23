//! Cache-bypassing completion over one unsaved source snapshot.

use std::collections::HashMap;

use crux_indexer_primitives::completion::{CompletionInsertion, completion_site_manifest};
use oxc_allocator::Allocator;
use oxc_parser::Parser;
use oxc_semantic::SemanticBuilder;
use oxc_span::SourceType;

use crate::{
    completion_classify::{ClassifiedSlot, classify_slot},
    completion_items::completion_item,
    protocol::completion::{
        CompletionCandidate, CompletionPosition, CompletionQueryRequest, CompletionQueryResponse,
        CompletionRange,
    },
    syntax::{
        imports::collect_import_records, semantic_imports::SemanticImportIndex, source::SourceView,
    },
};

const MAX_COMPLETIONS: usize = 100;
const COMPLETION_SENTINEL: &str = "__crux_completion";
const RECOVERY_SUFFIXES: &[&str] = &["", "\n})", "\n]})", "\n}})", "\n]}})"];

/// Completes a compiler-recognized slot without reading or writing index state.
pub fn complete(request: CompletionQueryRequest) -> CompletionQueryResponse {
    let Some(cursor) = byte_offset(&request.source, request.position) else {
        return CompletionQueryResponse::default();
    };
    if let Some(response) = complete_parsed(&request, cursor, &request.source) {
        return response;
    }

    // The sentinel occupies only the empty slot and every recovery suffix is
    // appended after the original cursor. Original offsets therefore remain
    // valid while Oxc receives enough local structure to classify dirty syntax.
    for suffix in RECOVERY_SUFFIXES {
        let recovered = format!(
            "{}{COMPLETION_SENTINEL}{}{}",
            &request.source[..cursor],
            &request.source[cursor..],
            suffix
        );
        if let Some(response) = complete_parsed(&request, cursor, &recovered) {
            return response;
        }
    }
    CompletionQueryResponse::default()
}

fn complete_parsed(
    request: &CompletionQueryRequest,
    cursor: usize,
    parsed_source: &str,
) -> Option<CompletionQueryResponse> {
    let allocator = Allocator::default();
    let source_type = SourceType::from_path(&request.file)
        .unwrap_or_default()
        .with_module(true);
    let parsed = Parser::new(&allocator, parsed_source, source_type).parse();
    if parsed.panicked {
        return None;
    }
    let semantic = SemanticBuilder::new()
        .with_build_nodes(true)
        .build(&parsed.program)
        .semantic;
    let source_view = SourceView::new(&request.file, parsed_source);
    let import_records =
        collect_import_records("", &request.file, &parsed.program.body, &source_view);
    let imports_by_local_name = import_records
        .iter()
        .map(|record| (record.local_name.clone(), record.clone()))
        .collect::<HashMap<_, _>>();
    let imports = SemanticImportIndex::new(
        semantic.scoping(),
        &parsed.program.body,
        &imports_by_local_name,
    );
    let slot = classify_slot(&semantic, &imports, cursor, completion_site_manifest())?;
    let replacement = CompletionRange {
        start: position_for_offset(&request.source, slot.replacement.start as usize),
        end: position_for_offset(&request.source, slot.replacement.end as usize),
    };
    let candidate_counts = request.candidates.iter().fold(
        HashMap::<(&str, &str), usize>::new(),
        |mut counts, candidate| {
            *counts
                .entry((candidate.file.as_str(), candidate.binding.as_str()))
                .or_default() += 1;
            counts
        },
    );
    let mut items = request
        .candidates
        .iter()
        .filter(|candidate| compatible(&slot, candidate))
        .filter(|candidate| !existing_candidate(&slot, candidate))
        .filter(|candidate| {
            slot.site.insertion == CompletionInsertion::StaticId
                || candidate_counts.get(&(candidate.file.as_str(), candidate.binding.as_str()))
                    == Some(&1)
        })
        .filter_map(|candidate| {
            completion_item(
                candidate,
                &slot,
                &request.file,
                cursor,
                &semantic,
                &parsed.program,
                &request.source,
                replacement,
            )
        })
        .collect::<Vec<_>>();
    items.sort_by(|left, right| {
        match_rank(&slot.prefix, &left.0.label, left.4)
            .cmp(&match_rank(&slot.prefix, &right.0.label, right.4))
            .then_with(|| right.1.cmp(&left.1))
            .then_with(|| right.2.cmp(&left.2))
            .then_with(|| right.3.cmp(&left.3))
            .then_with(|| left.4.file.cmp(&right.4.file))
            .then_with(|| left.4.line.cmp(&right.4.line))
            .then_with(|| left.4.character.cmp(&right.4.character))
            .then_with(|| left.4.kind.cmp(&right.4.kind))
            .then_with(|| left.4.id.cmp(&right.4.id))
            .then_with(|| left.0.label.cmp(&right.0.label))
    });

    let limit = request.limit.min(MAX_COMPLETIONS);
    let is_incomplete = items.len() > limit;
    items.truncate(limit);
    Some(CompletionQueryResponse {
        is_incomplete,
        items: items.into_iter().map(|item| item.0).collect(),
    })
}

fn compatible(slot: &ClassifiedSlot<'_>, candidate: &CompletionCandidate) -> bool {
    slot.site
        .accepted_kinds
        .iter()
        .any(|kind| kind == &candidate.kind)
        && (!slot.site.exclude_self || slot.owner_name.as_deref() != Some(candidate.name.as_str()))
}

fn existing_candidate(slot: &ClassifiedSlot<'_>, candidate: &CompletionCandidate) -> bool {
    match slot.site.insertion {
        CompletionInsertion::Identifier => slot.existing.contains(&candidate.binding),
        CompletionInsertion::ToolMapMember => {
            slot.existing.contains(&candidate.name) || slot.existing.contains(&candidate.binding)
        }
        CompletionInsertion::StaticId => slot.existing.contains(&candidate.name),
    }
}

fn match_rank(prefix: &str, label: &str, candidate: &CompletionCandidate) -> u8 {
    let values = [label, candidate.name.as_str(), candidate.id.as_str()];
    if values.contains(&prefix) {
        0
    } else if prefix.is_empty() || values.iter().any(|value| value.starts_with(prefix)) {
        1
    } else {
        2
    }
}

fn byte_offset(source: &str, position: CompletionPosition) -> Option<usize> {
    let line_start = line_start(source, position.line as usize)?;
    let line_end = source[line_start..]
        .find('\n')
        .map_or(source.len(), |offset| line_start + offset);
    let line = &source[line_start..line_end];
    let target = position.character as usize;
    let mut utf16 = 0;
    for (byte, character) in line.char_indices() {
        if utf16 == target {
            return Some(line_start + byte);
        }
        utf16 += character.len_utf16();
        if utf16 > target {
            return None;
        }
    }
    (utf16 == target).then_some(line_end)
}

pub(crate) fn position_for_offset(source: &str, offset: usize) -> CompletionPosition {
    let offset = offset.min(source.len());
    let line = source.as_bytes()[..offset]
        .iter()
        .filter(|byte| **byte == b'\n')
        .count();
    let start = source.as_bytes()[..offset]
        .iter()
        .rposition(|byte| *byte == b'\n')
        .map_or(0, |index| index + 1);
    CompletionPosition {
        line: line as u32,
        character: source[start..offset].encode_utf16().count() as u32,
    }
}

fn line_start(source: &str, line: usize) -> Option<usize> {
    if line == 0 {
        return Some(0);
    }
    source
        .match_indices('\n')
        .nth(line - 1)
        .map(|(index, _)| index + 1)
}
