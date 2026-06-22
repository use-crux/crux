use oxc_ast::ast::*;

use crate::{
    protocol::StaticImportRecord, resolve::resolve_static_import_file, source::SourceView,
};

pub fn collect_import_records(
    root: &str,
    file: &str,
    statements: &[Statement<'_>],
    view: &SourceView<'_>,
) -> Vec<StaticImportRecord> {
    statements
        .iter()
        .filter_map(|statement| match statement {
            Statement::ImportDeclaration(import) => Some(import),
            _ => None,
        })
        .flat_map(|import| {
            let module_specifier = import.source.value.as_str().to_string();
            let resolved_file = resolve_static_import_file(root, file, &module_specifier);
            import
                .specifiers
                .as_ref()
                .into_iter()
                .flatten()
                .map(move |specifier| {
                    let (local_name, imported_name) = import_specifier_names(specifier);
                    StaticImportRecord {
                        local_name,
                        imported_name,
                        module_specifier: module_specifier.clone(),
                        resolved_file: resolved_file.clone(),
                        source: view.location_for_span(&**import),
                    }
                })
        })
        .collect()
}

fn import_specifier_names(specifier: &ImportDeclarationSpecifier<'_>) -> (String, String) {
    match specifier {
        ImportDeclarationSpecifier::ImportSpecifier(specifier) => (
            specifier.local.name.as_str().to_string(),
            module_export_name(&specifier.imported),
        ),
        ImportDeclarationSpecifier::ImportDefaultSpecifier(specifier) => (
            specifier.local.name.as_str().to_string(),
            "default".to_string(),
        ),
        ImportDeclarationSpecifier::ImportNamespaceSpecifier(specifier) => {
            (specifier.local.name.as_str().to_string(), "*".to_string())
        }
    }
}

fn module_export_name(name: &ModuleExportName<'_>) -> String {
    match name {
        ModuleExportName::IdentifierName(identifier) => identifier.name.as_str().to_string(),
        ModuleExportName::IdentifierReference(identifier) => identifier.name.as_str().to_string(),
        ModuleExportName::StringLiteral(literal) => literal.value.as_str().to_string(),
    }
}
