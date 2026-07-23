use oxc_ast::ast::*;
use oxc_span::GetSpan;

use crate::{
    completion::position_for_offset,
    protocol::completion::{CompletionRange, CompletionTextEdit},
};

pub(crate) fn compatible_named_import(import: &ImportDeclaration<'_>) -> bool {
    import.import_kind == ImportOrExportKind::Value
        && import.with_clause.is_none()
        && import.specifiers.as_ref().is_some_and(|specifiers| {
            (specifiers.is_empty()
                || specifiers.iter().any(|specifier| {
                    matches!(specifier, ImportDeclarationSpecifier::ImportSpecifier(_))
                }))
                && !specifiers.iter().any(|specifier| {
                    matches!(
                        specifier,
                        ImportDeclarationSpecifier::ImportNamespaceSpecifier(_)
                    )
                })
        })
}

pub(crate) fn merge_named_import(
    source: &str,
    import: &ImportDeclaration<'_>,
    binding: &str,
) -> Option<CompletionTextEdit> {
    let before_source =
        source.get(import.span.start as usize..import.source.span.start as usize)?;
    let close = import.span.start as usize + before_source.rfind('}')?;
    let specifiers = import.specifiers.as_ref()?;
    let trailing_start = specifiers
        .last()
        .map(|specifier| specifier.span().end as usize)
        .or_else(|| {
            let open = before_source[..close - import.span.start as usize].rfind('{')?;
            Some(import.span.start as usize + open + 1)
        })?;
    let trailing = source.get(trailing_start..close)?.trim();
    if !matches!(trailing, "" | ",") {
        return None;
    }
    let whitespace_start = source[..close]
        .char_indices()
        .rev()
        .find(|(_, character)| !character.is_whitespace())
        .map_or(close, |(offset, character)| offset + character.len_utf8());
    let whitespace = &source[whitespace_start..close];
    let previous = source[..whitespace_start].chars().next_back()?;
    let new_text = match previous {
        '{' => format!(" {binding} "),
        ',' => format!(" {binding},{whitespace}"),
        _ => format!(", {binding}{whitespace}"),
    };
    Some(CompletionTextEdit {
        range: CompletionRange {
            start: position_for_offset(source, whitespace_start),
            end: position_for_offset(source, close),
        },
        new_text,
    })
}

pub(crate) fn insert_named_import(
    source: &str,
    program: &Program<'_>,
    module_specifier: &str,
    binding: &str,
) -> Option<CompletionTextEdit> {
    let offset = safe_import_insertion(source, program)?;
    let newline = if source.contains("\r\n") {
        "\r\n"
    } else {
        "\n"
    };
    let quote = dominant_quote(source, program);
    let semicolon = dominant_semicolon(source, program);
    let prefix = (offset > 0 && !source[..offset].ends_with('\n'))
        .then_some(newline)
        .unwrap_or("");
    let text = format!(
        "{prefix}import {{ {binding} }} from {quote}{module_specifier}{quote}{semicolon}{newline}"
    );
    let position = position_for_offset(source, offset);
    Some(CompletionTextEdit {
        range: CompletionRange {
            start: position,
            end: position,
        },
        new_text: text,
    })
}

fn safe_import_insertion(source: &str, program: &Program<'_>) -> Option<usize> {
    let mut saw_non_import = false;
    let mut last_leading_import = None;
    for statement in &program.body {
        match statement {
            Statement::ImportDeclaration(import) if !saw_non_import => {
                last_leading_import = Some(import.span.end as usize);
            }
            Statement::ImportDeclaration(_) => return None,
            _ => saw_non_import = true,
        }
    }
    if let Some(end) = last_leading_import {
        return Some(
            source[end..]
                .find('\n')
                .map_or(source.len(), |next| end + next + 1),
        );
    }
    if let Some(statement) = program.body.first() {
        return Some(line_start(source, statement.span().start as usize));
    }
    program
        .directives
        .last()
        .map(|directive| directive.span.end as usize)
        .map_or(Some(0), |end| {
            Some(
                source[end..]
                    .find('\n')
                    .map_or(source.len(), |next| end + next + 1),
            )
        })
}

fn dominant_quote(source: &str, program: &Program<'_>) -> char {
    let (single, double) = program.body.iter().fold((0, 0), |counts, statement| {
        let Statement::ImportDeclaration(import) = statement else {
            return counts;
        };
        match source.as_bytes().get(import.source.span.start as usize) {
            Some(b'\'') => (counts.0 + 1, counts.1),
            Some(b'"') => (counts.0, counts.1 + 1),
            _ => counts,
        }
    });
    if double > single { '"' } else { '\'' }
}

fn dominant_semicolon(source: &str, program: &Program<'_>) -> &'static str {
    let (with, without) = program.body.iter().fold((0, 0), |counts, statement| {
        let end = statement.span().end as usize;
        if end > source.len() {
            return counts;
        }
        if source[..end].trim_end().ends_with(';') {
            (counts.0 + 1, counts.1)
        } else {
            (counts.0, counts.1 + 1)
        }
    });
    if with > without { ";" } else { "" }
}

fn line_start(source: &str, offset: usize) -> usize {
    source.as_bytes()[..offset]
        .iter()
        .rposition(|byte| *byte == b'\n')
        .map_or(0, |index| index + 1)
}
