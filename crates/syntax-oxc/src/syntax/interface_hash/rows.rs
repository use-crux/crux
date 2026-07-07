use std::collections::BTreeMap;

use oxc_ast::ast::*;
use oxc_span::GetSpan;

use super::exports::{exported_name, local_exports, module_export_name};
use super::signatures::{
    binding_names, class_signature, function_signature, initializer_interface,
};
use super::text::{surface_text, type_annotation_text};

pub(super) fn exported_interface_rows(program: &Program<'_>, source: &str) -> Vec<String> {
    let local_exports = local_exports(program);
    let mut rows = Vec::new();
    for statement in &program.body {
        statement_rows(source, statement, &local_exports, &mut rows);
    }
    rows.sort();
    rows
}

fn statement_rows(
    source: &str,
    statement: &Statement<'_>,
    local_exports: &BTreeMap<String, String>,
    rows: &mut Vec<String>,
) {
    match statement {
        Statement::ExportAllDeclaration(export) => {
            let module_specifier = surface_text(source, export.source.span);
            if let Some(exported) = &export.exported {
                rows.push(format!(
                    "export-namespace:{}:{}",
                    module_export_name(exported),
                    module_specifier
                ));
            } else {
                rows.push(format!("export-all:{module_specifier}"));
            }
        }
        Statement::ExportDefaultDeclaration(export) => {
            export_default_rows(source, export, rows);
        }
        Statement::ExportNamedDeclaration(export) => {
            if let Some(declaration) = &export.declaration {
                declaration_rows(source, declaration, &BTreeMap::new(), true, rows);
            } else {
                export_declaration_rows(source, export, rows);
            }
        }
        Statement::TSExportAssignment(export) => {
            rows.push(format!(
                "export-assignment:{}",
                surface_text(source, export.expression.span())
            ));
        }
        Statement::FunctionDeclaration(function) => {
            if let Some(name) = function
                .id
                .as_ref()
                .and_then(|id| local_exports.get(id.name.as_str()))
            {
                rows.push(format!(
                    "function:{}:{}",
                    name,
                    function_signature(source, function)
                ));
            }
        }
        Statement::ClassDeclaration(class) => {
            if let Some(name) = class
                .id
                .as_ref()
                .and_then(|id| local_exports.get(id.name.as_str()))
            {
                rows.push(format!("class:{}:{}", name, class_signature(source, class)));
            }
        }
        Statement::TSTypeAliasDeclaration(declaration) => {
            if let Some(name) = local_exports.get(declaration.id.name.as_str()) {
                rows.push(format!(
                    "declaration:{}:{}",
                    name,
                    surface_text(source, declaration.span)
                ));
            }
        }
        Statement::TSInterfaceDeclaration(declaration) => {
            if let Some(name) = local_exports.get(declaration.id.name.as_str()) {
                rows.push(format!(
                    "declaration:{}:{}",
                    name,
                    surface_text(source, declaration.span)
                ));
            }
        }
        Statement::TSEnumDeclaration(declaration) => {
            if let Some(name) = local_exports.get(declaration.id.name.as_str()) {
                rows.push(format!(
                    "declaration:{}:{}",
                    name,
                    surface_text(source, declaration.span)
                ));
            }
        }
        Statement::VariableDeclaration(declaration) => {
            variable_rows(source, declaration, local_exports, false, rows);
        }
        _ => {}
    }
}

fn declaration_rows(
    source: &str,
    declaration: &Declaration<'_>,
    local_exports: &BTreeMap<String, String>,
    direct_export: bool,
    rows: &mut Vec<String>,
) {
    match declaration {
        Declaration::FunctionDeclaration(function) => {
            let name = exported_name(
                function.id.as_ref().map(|id| id.name.as_str()),
                direct_export,
                false,
                local_exports,
            );
            if let Some(name) = name {
                rows.push(format!(
                    "function:{}:{}",
                    name,
                    function_signature(source, function)
                ));
            }
        }
        Declaration::ClassDeclaration(class) => {
            let name = exported_name(
                class.id.as_ref().map(|id| id.name.as_str()),
                direct_export,
                false,
                local_exports,
            );
            if let Some(name) = name {
                rows.push(format!("class:{}:{}", name, class_signature(source, class)));
            }
        }
        Declaration::TSTypeAliasDeclaration(declaration) => {
            let name = exported_name(
                Some(declaration.id.name.as_str()),
                direct_export,
                false,
                local_exports,
            );
            if let Some(name) = name {
                rows.push(format!(
                    "declaration:{}:{}",
                    name,
                    surface_text(source, declaration.span)
                ));
            }
        }
        Declaration::TSInterfaceDeclaration(declaration) => {
            let name = exported_name(
                Some(declaration.id.name.as_str()),
                direct_export,
                false,
                local_exports,
            );
            if let Some(name) = name {
                rows.push(format!(
                    "declaration:{}:{}",
                    name,
                    surface_text(source, declaration.span)
                ));
            }
        }
        Declaration::TSEnumDeclaration(declaration) => {
            let name = exported_name(
                Some(declaration.id.name.as_str()),
                direct_export,
                false,
                local_exports,
            );
            if let Some(name) = name {
                rows.push(format!(
                    "declaration:{}:{}",
                    name,
                    surface_text(source, declaration.span)
                ));
            }
        }
        Declaration::VariableDeclaration(declaration) => {
            variable_rows(source, declaration, local_exports, direct_export, rows);
        }
        _ => {}
    }
}

fn export_default_rows(
    source: &str,
    export: &ExportDefaultDeclaration<'_>,
    rows: &mut Vec<String>,
) {
    match &export.declaration {
        ExportDefaultDeclarationKind::FunctionDeclaration(function) => {
            rows.push(format!(
                "function:default:{}",
                function_signature(source, function)
            ));
        }
        ExportDefaultDeclarationKind::ClassDeclaration(class) => {
            rows.push(format!("class:default:{}", class_signature(source, class)));
        }
        ExportDefaultDeclarationKind::TSInterfaceDeclaration(declaration) => {
            rows.push(format!(
                "declaration:default:{}",
                surface_text(source, declaration.span)
            ));
        }
        other => rows.push(format!(
            "export-assignment:{}",
            surface_text(source, other.span())
        )),
    }
}

fn export_declaration_rows(
    source: &str,
    export: &ExportNamedDeclaration<'_>,
    rows: &mut Vec<String>,
) {
    let module_specifier = export
        .source
        .as_ref()
        .map(|source_literal| surface_text(source, source_literal.span))
        .unwrap_or_default();
    for specifier in &export.specifiers {
        rows.push(format!(
            "export:{}:{}:{}",
            module_export_name(&specifier.local),
            module_export_name(&specifier.exported),
            module_specifier
        ));
    }
}

fn variable_rows(
    source: &str,
    declaration: &VariableDeclaration<'_>,
    local_exports: &BTreeMap<String, String>,
    direct_export: bool,
    rows: &mut Vec<String>,
) {
    for declarator in &declaration.declarations {
        for local_name in binding_names(&declarator.id) {
            let exported = if direct_export {
                Some(local_name.clone())
            } else {
                local_exports.get(&local_name).cloned()
            };
            let Some(exported) = exported else { continue };
            rows.push(format!(
                "variable:{}:{}:{}",
                exported,
                declarator
                    .type_annotation
                    .as_ref()
                    .map(|annotation| type_annotation_text(source, annotation.span))
                    .unwrap_or_default(),
                declarator
                    .init
                    .as_ref()
                    .map(|expression| initializer_interface(source, expression))
                    .unwrap_or_default()
            ));
        }
    }
}
