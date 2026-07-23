//! Compiler-owned binding and import recipes for transient completion.

use oxc_ast::ast::*;
use oxc_semantic::{ScopeId, Semantic, SymbolId};

use crate::{
    completion_import_edits::{compatible_named_import, insert_named_import, merge_named_import},
    completion_import_paths::{
        relative_module_specifier, safe_binding_name, same_directory, same_module_specifier,
    },
    protocol::completion::{CompletionCandidate, CompletionTextEdit},
};

pub(crate) struct CompletionRecipe {
    pub(crate) binding: String,
    pub(crate) additional_text_edits: Vec<CompletionTextEdit>,
    pub(crate) accessible: bool,
    pub(crate) same_file: bool,
    pub(crate) same_directory: bool,
}

pub(crate) fn completion_recipe(
    candidate: &CompletionCandidate,
    current_file: &str,
    cursor: usize,
    scope_id: ScopeId,
    semantic: &Semantic<'_>,
    program: &Program<'_>,
    source: &str,
) -> Option<CompletionRecipe> {
    if candidate.file == current_file {
        return accessible_same_file_binding(semantic, scope_id, &candidate.binding, cursor).map(
            |binding| CompletionRecipe {
                binding,
                additional_text_edits: Vec::new(),
                accessible: true,
                same_file: true,
                same_directory: true,
            },
        );
    }
    if !safe_binding_name(&candidate.binding) {
        return None;
    }

    let module_specifier = relative_module_specifier(current_file, &candidate.file)?;
    let matching_imports = matching_imports(program, &module_specifier);
    match existing_named_binding(semantic, scope_id, &matching_imports, &candidate.binding) {
        ExistingBinding::Visible(binding) => {
            return Some(CompletionRecipe {
                binding,
                additional_text_edits: Vec::new(),
                accessible: true,
                same_file: false,
                same_directory: same_directory(current_file, &candidate.file),
            });
        }
        ExistingBinding::Unavailable => return None,
        ExistingBinding::Missing => {}
    }
    if semantic
        .scoping()
        .find_binding(scope_id, candidate.binding.as_str().into())
        .is_some()
    {
        return None;
    }

    let compatible = matching_imports
        .iter()
        .filter(|import| compatible_named_import(import))
        .copied()
        .collect::<Vec<_>>();
    let edit = match compatible.as_slice() {
        [import] => merge_named_import(source, import, &candidate.binding)?,
        [] => insert_named_import(source, program, &module_specifier, &candidate.binding)?,
        _ => return None,
    };
    Some(CompletionRecipe {
        binding: candidate.binding.clone(),
        additional_text_edits: vec![edit],
        accessible: false,
        same_file: false,
        same_directory: same_directory(current_file, &candidate.file),
    })
}

fn accessible_same_file_binding(
    semantic: &Semantic<'_>,
    scope_id: ScopeId,
    binding: &str,
    cursor: usize,
) -> Option<String> {
    let visible = semantic.scoping().find_binding(scope_id, binding.into())?;
    if semantic.scoping().symbol_span(visible).start >= cursor as u32 {
        return None;
    }
    let root = semantic
        .scoping()
        .find_binding(semantic.scoping().root_scope_id(), binding.into());
    let unambiguous_nested = semantic
        .scoping()
        .symbol_names()
        .filter(|name| *name == binding)
        .count()
        == 1;
    (root == Some(visible) || unambiguous_nested).then(|| binding.to_string())
}

fn matching_imports<'a>(
    program: &'a Program<'a>,
    expected: &str,
) -> Vec<&'a ImportDeclaration<'a>> {
    program
        .body
        .iter()
        .filter_map(|statement| match statement {
            Statement::ImportDeclaration(import)
                if same_module_specifier(import.source.value.as_str(), expected) =>
            {
                Some(import.as_ref())
            }
            _ => None,
        })
        .collect()
}

enum ExistingBinding {
    Missing,
    Visible(String),
    Unavailable,
}

fn existing_named_binding(
    semantic: &Semantic<'_>,
    scope_id: ScopeId,
    imports: &[&ImportDeclaration<'_>],
    export_name: &str,
) -> ExistingBinding {
    for import in imports {
        if import.import_kind == ImportOrExportKind::Type {
            continue;
        }
        for specifier in import.specifiers.as_ref().into_iter().flatten() {
            let ImportDeclarationSpecifier::ImportSpecifier(specifier) = specifier else {
                continue;
            };
            if specifier.import_kind == ImportOrExportKind::Type
                || module_export_name(&specifier.imported) != export_name
            {
                continue;
            }
            let local = specifier.local.name.as_str();
            if visible_symbol(semantic, scope_id, local) == specifier.local.symbol_id.get() {
                return ExistingBinding::Visible(local.to_string());
            }
            return ExistingBinding::Unavailable;
        }
    }
    ExistingBinding::Missing
}

fn visible_symbol(semantic: &Semantic<'_>, scope_id: ScopeId, name: &str) -> Option<SymbolId> {
    semantic.scoping().find_binding(scope_id, name.into())
}

fn module_export_name<'a>(name: &'a ModuleExportName<'a>) -> &'a str {
    match name {
        ModuleExportName::IdentifierName(identifier) => identifier.name.as_str(),
        ModuleExportName::IdentifierReference(identifier) => identifier.name.as_str(),
        ModuleExportName::StringLiteral(literal) => literal.value.as_str(),
    }
}
