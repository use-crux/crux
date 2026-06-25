use std::collections::HashMap;

use oxc_ast::ast::*;
use oxc_span::Span;

use crate::{
    protocol::{StaticImportRecord, StaticInitializerRecord, StaticSyntaxValue},
    syntax::function_calls::function_calls_from_statements,
    syntax::source::SourceView,
    syntax::values::{initializer_records_from_declarator, syntax_value_from_expression},
};

type ImportsByLocalName = HashMap<String, StaticImportRecord>;

pub fn function_value_from_function(
    view: &SourceView<'_>,
    function: &Function<'_>,
    imports: &ImportsByLocalName,
    source_span: Span,
) -> StaticSyntaxValue {
    let body = function.body.as_deref();
    StaticSyntaxValue::Function {
        calls: body.map_or_else(Vec::new, |body| {
            function_calls_from_statements(view, &body.statements, imports)
        }),
        returns: body.map_or_else(Vec::new, |body| {
            function_returns_from_statements(view, &body.statements, imports)
        }),
        local_initializers: body.map_or_else(Vec::new, |body| {
            function_initializers_from_statements(view, &body.statements, imports)
        }),
        source: view.location_for_offset(source_span.start as usize),
        snippet: Some(view.snippet_for_raw_span(source_span)),
    }
}

pub fn function_value_from_arrow(
    view: &SourceView<'_>,
    function: &ArrowFunctionExpression<'_>,
    imports: &ImportsByLocalName,
) -> StaticSyntaxValue {
    let mut returns = function_returns_from_statements(view, &function.body.statements, imports);
    if function.expression {
        if let Some(Statement::ExpressionStatement(statement)) = function.body.statements.first() {
            returns.insert(
                0,
                syntax_value_from_expression(view, &statement.expression, imports),
            );
        }
    }
    StaticSyntaxValue::Function {
        calls: function_calls_from_statements(view, &function.body.statements, imports),
        returns,
        local_initializers: function_initializers_from_statements(
            view,
            &function.body.statements,
            imports,
        ),
        source: view.location_for_span(function),
        snippet: Some(view.snippet_for_span(function)),
    }
}

fn function_returns_from_statements(
    view: &SourceView<'_>,
    statements: &[Statement<'_>],
    imports: &ImportsByLocalName,
) -> Vec<StaticSyntaxValue> {
    let mut returns = Vec::new();
    for statement in statements {
        collect_returns_from_statement(view, statement, imports, &mut returns);
    }
    returns
}

fn function_initializers_from_statements(
    view: &SourceView<'_>,
    statements: &[Statement<'_>],
    imports: &ImportsByLocalName,
) -> Vec<StaticInitializerRecord> {
    let mut initializers = Vec::new();
    for statement in statements {
        collect_initializers_from_statement(view, statement, imports, &mut initializers);
    }
    initializers
}

fn collect_returns_from_statement(
    view: &SourceView<'_>,
    statement: &Statement<'_>,
    imports: &ImportsByLocalName,
    returns: &mut Vec<StaticSyntaxValue>,
) {
    match statement {
        Statement::ReturnStatement(statement) => {
            if let Some(argument) = &statement.argument {
                returns.push(syntax_value_from_expression(view, argument, imports));
            }
        }
        Statement::BlockStatement(block) => {
            for statement in &block.body {
                collect_returns_from_statement(view, statement, imports, returns);
            }
        }
        Statement::IfStatement(statement) => {
            collect_returns_from_statement(view, &statement.consequent, imports, returns);
            if let Some(alternate) = &statement.alternate {
                collect_returns_from_statement(view, alternate, imports, returns);
            }
        }
        _ => {}
    }
}

fn collect_initializers_from_statement(
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
                collect_initializers_from_statement(view, statement, imports, initializers);
            }
        }
        Statement::IfStatement(statement) => {
            collect_initializers_from_statement(view, &statement.consequent, imports, initializers);
            if let Some(alternate) = &statement.alternate {
                collect_initializers_from_statement(view, alternate, imports, initializers);
            }
        }
        Statement::FunctionDeclaration(_) => {}
        _ => {}
    }
}
