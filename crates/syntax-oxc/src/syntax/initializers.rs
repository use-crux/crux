use oxc_ast::ast::*;
use oxc_span::{GetSpan, Span};

use crate::{
    protocol::StaticInitializerRecord, syntax::function_values::function_value_from_function,
    syntax::semantic_imports::SemanticImportIndex,
    syntax::semantic_initializers::SemanticInitializerIndex, syntax::source::SourceView,
    syntax::values::initializer_records_from_declarator_with_index,
};

pub fn collect_local_initializers(
    view: &SourceView<'_>,
    statements: &[Statement<'_>],
    imports: &SemanticImportIndex<'_>,
    initializer_index: &SemanticInitializerIndex<'_>,
) -> Vec<StaticInitializerRecord> {
    statements
        .iter()
        .flat_map(|statement| match statement {
            Statement::FunctionDeclaration(function) => function_initializer(
                view,
                function,
                function.span(),
                imports,
                Some(initializer_index),
            ),
            Statement::VariableDeclaration(declaration) => declaration
                .declarations
                .iter()
                .flat_map(|item| {
                    initializer_records_from_declarator_with_index(
                        view,
                        item,
                        imports,
                        Some(initializer_index),
                    )
                })
                .collect(),
            Statement::ExportNamedDeclaration(export) => export
                .declaration
                .as_ref()
                .map(|declaration| {
                    local_initializers_from_declaration(
                        view,
                        declaration,
                        export.span(),
                        imports,
                        initializer_index,
                    )
                })
                .unwrap_or_default(),
            _ => Vec::new(),
        })
        .collect()
}

fn local_initializers_from_declaration(
    view: &SourceView<'_>,
    declaration: &Declaration<'_>,
    source_span: Span,
    imports: &SemanticImportIndex<'_>,
    initializer_index: &SemanticInitializerIndex<'_>,
) -> Vec<StaticInitializerRecord> {
    match declaration {
        Declaration::FunctionDeclaration(function) => function_initializer(
            view,
            function,
            source_span,
            imports,
            Some(initializer_index),
        ),
        Declaration::VariableDeclaration(declaration) => declaration
            .declarations
            .iter()
            .flat_map(|item| {
                initializer_records_from_declarator_with_index(
                    view,
                    item,
                    imports,
                    Some(initializer_index),
                )
            })
            .collect(),
        _ => Vec::new(),
    }
}

pub(crate) fn function_initializer(
    view: &SourceView<'_>,
    function: &Function<'_>,
    source_span: Span,
    imports: &SemanticImportIndex<'_>,
    initializer_index: Option<&SemanticInitializerIndex<'_>>,
) -> Vec<StaticInitializerRecord> {
    let Some(id) = &function.id else {
        return Vec::new();
    };
    vec![StaticInitializerRecord {
        name: id.name.as_str().to_string(),
        value: function_value_from_function(
            view,
            function,
            imports,
            initializer_index,
            source_span,
        ),
        source: view.location_for_offset(source_span.start as usize),
        snippet: Some(view.snippet_for_raw_span(source_span)),
    }]
}
