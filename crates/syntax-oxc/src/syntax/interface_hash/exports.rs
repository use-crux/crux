use std::collections::BTreeMap;

use oxc_ast::ast::*;

pub(super) fn local_exports(program: &Program<'_>) -> BTreeMap<String, String> {
    let mut exports = BTreeMap::new();
    for statement in &program.body {
        let Statement::ExportNamedDeclaration(export) = statement else {
            continue;
        };
        if export.source.is_some() || export.declaration.is_some() {
            continue;
        }
        for specifier in &export.specifiers {
            exports.insert(
                module_export_name(&specifier.local),
                module_export_name(&specifier.exported),
            );
        }
    }
    exports
}

pub(super) fn exported_name(
    fallback: Option<&str>,
    direct_export: bool,
    default_export: bool,
    local_exports: &BTreeMap<String, String>,
) -> Option<String> {
    if default_export {
        return Some("default".to_string());
    }
    if direct_export {
        return Some(fallback.unwrap_or("default").to_string());
    }
    fallback.and_then(|name| local_exports.get(name).cloned())
}

pub(super) fn module_export_name(name: &ModuleExportName<'_>) -> String {
    match name {
        ModuleExportName::IdentifierName(identifier) => identifier.name.as_str().to_string(),
        ModuleExportName::IdentifierReference(identifier) => identifier.name.as_str().to_string(),
        ModuleExportName::StringLiteral(literal) => literal.value.as_str().to_string(),
    }
}
