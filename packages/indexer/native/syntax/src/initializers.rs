use std::collections::HashMap;

use oxc_ast::ast::*;
use oxc_span::{GetSpan, Span};

use crate::{
    function_values::function_value_from_function,
    protocol::{StaticImportRecord, StaticInitializerRecord},
    source::SourceView,
    values::initializer_records_from_declarator,
};

type ImportsByLocalName = HashMap<String, StaticImportRecord>;

pub fn collect_local_initializers(
    view: &SourceView<'_>,
    statements: &[Statement<'_>],
    imports: &ImportsByLocalName,
) -> Vec<StaticInitializerRecord> {
    statements
        .iter()
        .flat_map(|statement| match statement {
            Statement::FunctionDeclaration(function) => {
                function_initializer(view, function, function.span(), imports)
            }
            Statement::VariableDeclaration(declaration) => declaration
                .declarations
                .iter()
                .flat_map(|item| initializer_records_from_declarator(view, item, imports))
                .collect(),
            Statement::ExportNamedDeclaration(export) => export
                .declaration
                .as_ref()
                .map(|declaration| {
                    local_initializers_from_declaration(view, declaration, export.span(), imports)
                })
                .unwrap_or_default(),
            _ => Vec::new(),
        })
        .collect()
}

pub fn scoped_initializers_for_function(
    view: &SourceView<'_>,
    function: &Function<'_>,
    imports: &ImportsByLocalName,
    inherited: &[StaticInitializerRecord],
) -> Vec<StaticInitializerRecord> {
    let mut initializers = inherited.to_vec();
    if let Some(body) = &function.body {
        for statement in &body.statements {
            collect_scoped_initializers(view, statement, imports, &mut initializers);
        }
    }
    initializers
}

pub fn scoped_initializers_for_arrow(
    view: &SourceView<'_>,
    function: &ArrowFunctionExpression<'_>,
    imports: &ImportsByLocalName,
    inherited: &[StaticInitializerRecord],
) -> Vec<StaticInitializerRecord> {
    let mut initializers = inherited.to_vec();
    for statement in &function.body.statements {
        collect_scoped_initializers(view, statement, imports, &mut initializers);
    }
    initializers
}

fn local_initializers_from_declaration(
    view: &SourceView<'_>,
    declaration: &Declaration<'_>,
    source_span: Span,
    imports: &ImportsByLocalName,
) -> Vec<StaticInitializerRecord> {
    match declaration {
        Declaration::FunctionDeclaration(function) => {
            function_initializer(view, function, source_span, imports)
        }
        Declaration::VariableDeclaration(declaration) => declaration
            .declarations
            .iter()
            .flat_map(|item| initializer_records_from_declarator(view, item, imports))
            .collect(),
        _ => Vec::new(),
    }
}

fn function_initializer(
    view: &SourceView<'_>,
    function: &Function<'_>,
    source_span: Span,
    imports: &ImportsByLocalName,
) -> Vec<StaticInitializerRecord> {
    let Some(id) = &function.id else {
        return Vec::new();
    };
    vec![StaticInitializerRecord {
        name: id.name.as_str().to_string(),
        value: function_value_from_function(view, function, imports, source_span),
        source: view.location_for_offset(source_span.start as usize),
        snippet: Some(view.snippet_for_raw_span(source_span)),
    }]
}

fn collect_scoped_initializers(
    view: &SourceView<'_>,
    statement: &Statement<'_>,
    imports: &ImportsByLocalName,
    initializers: &mut Vec<StaticInitializerRecord>,
) {
    match statement {
        Statement::VariableDeclaration(declaration) => {
            for declarator in &declaration.declarations {
                initializers.extend(initializer_records_from_declarator(
                    view, declarator, imports,
                ));
            }
        }
        Statement::BlockStatement(block) => {
            for statement in &block.body {
                collect_scoped_initializers(view, statement, imports, initializers);
            }
        }
        Statement::IfStatement(statement) => {
            collect_scoped_initializers(view, &statement.consequent, imports, initializers);
            if let Some(alternate) = &statement.alternate {
                collect_scoped_initializers(view, alternate, imports, initializers);
            }
        }
        _ => {}
    }
}
