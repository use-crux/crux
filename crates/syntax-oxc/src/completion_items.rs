//! Eager completion-item edit recipes after slot classification.

use crux_indexer_primitives::completion::CompletionInsertion;
use oxc_ast::ast::Program;
use oxc_semantic::Semantic;

use crate::{
    completion_classify::{ClassifiedSlot, ReplacementSyntax},
    completion_import_paths::relative_source_file,
    completion_imports::completion_recipe,
    protocol::completion::{
        CompletionCandidate, CompletionQueryItem, CompletionRange, CompletionTextEdit,
    },
};

pub(crate) type RankedItem<'candidate> = (
    CompletionQueryItem,
    bool,
    bool,
    bool,
    &'candidate CompletionCandidate,
);

/// Builds one eager item without retaining parser-owned objects.
#[allow(clippy::too_many_arguments)]
pub(crate) fn completion_item<'candidate>(
    candidate: &'candidate CompletionCandidate,
    slot: &ClassifiedSlot<'_>,
    current_file: &str,
    cursor: usize,
    semantic: &Semantic<'_>,
    program: &Program<'_>,
    source: &str,
    replacement: CompletionRange,
) -> Option<RankedItem<'candidate>> {
    if slot.site.insertion == CompletionInsertion::StaticId {
        let insert_text = match slot.replacement_syntax {
            ReplacementSyntax::StringLiteral => candidate.name.clone(),
            ReplacementSyntax::Identifier => quoted(candidate.name.as_str(), source),
        };
        return Some((
            query_item(
                candidate,
                candidate.name.clone(),
                insert_text,
                replacement,
                vec![],
                current_file,
            ),
            true,
            candidate.file == current_file,
            same_directory(current_file, &candidate.file),
            candidate,
        ));
    }

    let recipe = completion_recipe(
        candidate,
        current_file,
        cursor,
        slot.scope_id,
        semantic,
        program,
        source,
    )?;
    let insert_text = match slot.site.insertion {
        CompletionInsertion::Identifier => recipe.binding.clone(),
        CompletionInsertion::ToolMapMember => tool_map_member(candidate, &recipe.binding, source),
        CompletionInsertion::StaticId => unreachable!("handled above"),
    };
    Some((
        query_item(
            candidate,
            recipe.binding.clone(),
            insert_text,
            replacement,
            recipe.additional_text_edits,
            current_file,
        ),
        recipe.accessible,
        recipe.same_file,
        recipe.same_directory,
        candidate,
    ))
}

fn query_item(
    candidate: &CompletionCandidate,
    label: String,
    insert_text: String,
    replacement: CompletionRange,
    additional_text_edits: Vec<CompletionTextEdit>,
    current_file: &str,
) -> CompletionQueryItem {
    CompletionQueryItem {
        id: candidate.id.clone(),
        kind: candidate.kind.clone(),
        label,
        detail: completion_detail(candidate, current_file),
        insert_text,
        replacement,
        additional_text_edits,
    }
}

fn tool_map_member(candidate: &CompletionCandidate, binding: &str, source: &str) -> String {
    if candidate.name == binding && safe_identifier(binding) {
        binding.to_string()
    } else if safe_identifier(&candidate.name) {
        format!("{}: {binding}", candidate.name)
    } else {
        format!("{}: {binding}", quoted(&candidate.name, source))
    }
}

fn safe_identifier(value: &str) -> bool {
    let mut characters = value.chars();
    let Some(first) = characters.next() else {
        return false;
    };
    (first == '_' || first == '$' || first.is_ascii_alphabetic())
        && characters.all(|character| {
            character == '_' || character == '$' || character.is_ascii_alphanumeric()
        })
}

fn quoted(value: &str, source: &str) -> String {
    let quote = preferred_quote(source);
    let escaped = value
        .replace('\\', "\\\\")
        .replace(quote, &format!("\\{quote}"));
    format!("{quote}{escaped}{quote}")
}

fn preferred_quote(source: &str) -> char {
    if source.matches('"').count() > source.matches('\'').count() {
        '"'
    } else {
        '\''
    }
}

fn same_directory(left: &str, right: &str) -> bool {
    std::path::Path::new(left).parent() == std::path::Path::new(right).parent()
}

fn completion_detail(candidate: &CompletionCandidate, current_file: &str) -> String {
    let source_file = relative_source_file(current_file, &candidate.file).unwrap_or_else(|| {
        candidate
            .file
            .rsplit(['/', '\\'])
            .next()
            .unwrap_or(&candidate.file)
            .to_string()
    });
    let identity = format!("{} · {} · {source_file}", candidate.kind, candidate.id);
    candidate.description.as_ref().map_or_else(
        || identity.clone(),
        |description| format!("{identity} — {description}"),
    )
}
