use std::collections::HashMap;

use oxc_ast::ast::*;
use oxc_span::Span;

use crate::{
    protocol::{
        StaticFunctionParameterBinding, StaticImportRecord, StaticInitializerRecord,
        StaticSyntaxValue,
    },
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
        parameter_names: parameter_names_from_formal_parameters(&function.params),
        first_parameter_bindings: first_parameter_bindings_from_formal_parameters(&function.params),
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
        parameter_names: parameter_names_from_formal_parameters(&function.params),
        first_parameter_bindings: first_parameter_bindings_from_formal_parameters(&function.params),
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

fn parameter_names_from_formal_parameters(params: &FormalParameters<'_>) -> Vec<String> {
    params
        .items
        .iter()
        .filter_map(|param| binding_pattern_name(&param.pattern))
        .collect()
}

fn first_parameter_bindings_from_formal_parameters(
    params: &FormalParameters<'_>,
) -> Vec<StaticFunctionParameterBinding> {
    params
        .items
        .first()
        .map(|param| binding_entries(&param.pattern, None))
        .unwrap_or_default()
}

fn binding_pattern_name(pattern: &BindingPattern<'_>) -> Option<String> {
    match pattern {
        BindingPattern::BindingIdentifier(identifier) => Some(identifier.name.to_string()),
        _ => None,
    }
}

fn binding_entries(
    pattern: &BindingPattern<'_>,
    property_name: Option<String>,
) -> Vec<StaticFunctionParameterBinding> {
    match pattern {
        BindingPattern::BindingIdentifier(identifier) => vec![StaticFunctionParameterBinding {
            name: identifier.name.to_string(),
            property_name,
        }],
        BindingPattern::ObjectPattern(pattern) => pattern
            .properties
            .iter()
            .flat_map(|property| {
                let property_name = if property.shorthand {
                    None
                } else {
                    property_key_name(&property.key)
                };
                binding_entries(&property.value, property_name)
            })
            .chain(
                pattern
                    .rest
                    .iter()
                    .flat_map(|rest| binding_entries(&rest.argument, None)),
            )
            .collect(),
        BindingPattern::ArrayPattern(pattern) => pattern
            .elements
            .iter()
            .flatten()
            .flat_map(|element| binding_entries(element, None))
            .chain(
                pattern
                    .rest
                    .iter()
                    .flat_map(|rest| binding_entries(&rest.argument, None)),
            )
            .collect(),
        BindingPattern::AssignmentPattern(pattern) => binding_entries(&pattern.left, property_name),
    }
}

fn property_key_name(key: &PropertyKey<'_>) -> Option<String> {
    match key {
        PropertyKey::StaticIdentifier(identifier) => Some(identifier.name.as_str().to_string()),
        PropertyKey::Identifier(identifier) => Some(identifier.name.as_str().to_string()),
        PropertyKey::StringLiteral(literal) => Some(literal.value.as_str().to_string()),
        PropertyKey::NumericLiteral(literal) => Some(literal.value.to_string()),
        _ => None,
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
