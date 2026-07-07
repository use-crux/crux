use oxc_ast::ast::*;
use oxc_span::{GetSpan, Span};

use crate::{
    protocol::{LiteralValue, StaticCalleeRecord, StaticInitializerRecord, StaticSyntaxValue},
    syntax::argument_values::{argument_value, array_element_value, call_value},
    syntax::function_values::{function_value_from_arrow, function_value_from_function},
    syntax::semantic_imports::SemanticImportIndex,
    syntax::semantic_initializers::SemanticInitializerIndex,
    syntax::source::SourceView,
};

pub(crate) use crate::syntax::object_values::{object_value, property_access_value};

pub fn syntax_value_from_expression(
    view: &SourceView<'_>,
    expression: &Expression<'_>,
    imports: &SemanticImportIndex<'_>,
) -> StaticSyntaxValue {
    match expression {
        Expression::StringLiteral(literal) => StaticSyntaxValue::Literal {
            value: LiteralValue::String(literal.value.as_str().to_string()),
        },
        Expression::NumericLiteral(literal) => StaticSyntaxValue::Literal {
            value: LiteralValue::Number(literal.value),
        },
        Expression::BooleanLiteral(literal) => StaticSyntaxValue::Literal {
            value: LiteralValue::Boolean(literal.value),
        },
        Expression::NullLiteral(_) => StaticSyntaxValue::Literal {
            value: LiteralValue::Null,
        },
        Expression::Identifier(identifier) => StaticSyntaxValue::Identifier {
            name: identifier.name.as_str().to_string(),
        },
        Expression::StaticMemberExpression(member) => property_access_value(member),
        Expression::ObjectExpression(object) => object_value(view, object, imports),
        Expression::ArrayExpression(array) => StaticSyntaxValue::Array {
            elements: array
                .elements
                .iter()
                .filter_map(|element| array_element_value(view, element, imports))
                .collect(),
        },
        Expression::CallExpression(call) => call_value(view, call, imports),
        Expression::TemplateLiteral(template) => StaticSyntaxValue::Template {
            text: view.text_for_span(&**template),
            expressions: template
                .expressions
                .iter()
                .map(|expression| syntax_value_from_expression(view, expression, imports))
                .collect(),
        },
        Expression::AwaitExpression(await_expression) => {
            syntax_value_from_expression(view, &await_expression.argument, imports)
        }
        Expression::ParenthesizedExpression(parenthesized) => {
            syntax_value_from_expression(view, &parenthesized.expression, imports)
        }
        Expression::ArrowFunctionExpression(function) => {
            function_value_from_arrow(view, function, imports, None)
        }
        Expression::FunctionExpression(function) => {
            function_value_from_function(view, function, imports, None, function.span())
        }
        Expression::LogicalExpression(_) | Expression::BinaryExpression(_) => {
            unsupported_value(view, expression.span(), "BinaryExpression")
        }
        _ => unsupported_value(
            view,
            expression.span(),
            syntax_kind_for_expression(expression),
        ),
    }
}

pub fn callee_record_from_expression(
    expression: &Expression<'_>,
    imports: &SemanticImportIndex<'_>,
) -> StaticCalleeRecord {
    let direct = matches!(expression, Expression::Identifier(_));
    let Some(local_name) = expression_name(expression) else {
        return StaticCalleeRecord {
            name: "<unknown>".to_string(),
            direct: Some(direct),
            local_name: None,
            imported_name: None,
            module_specifier: None,
            resolved_file: None,
        };
    };
    if let Some(imported) = imports.record_for_callee(expression) {
        let member_import = matches!(expression, Expression::StaticMemberExpression(_));
        let imported_name = if member_import {
            local_name.clone()
        } else {
            imported.imported_name.clone()
        };
        return StaticCalleeRecord {
            name: imported_name.clone(),
            direct: Some(direct),
            local_name: Some(imported.local_name.clone()),
            imported_name: Some(imported_name),
            module_specifier: Some(imported.module_specifier.clone()),
            resolved_file: imported.resolved_file.clone(),
        };
    }
    StaticCalleeRecord {
        name: local_name.clone(),
        direct: Some(direct),
        local_name: Some(local_name),
        imported_name: None,
        module_specifier: None,
        resolved_file: None,
    }
}

pub fn expression_name(expression: &Expression<'_>) -> Option<String> {
    match expression {
        Expression::Identifier(identifier) => Some(identifier.name.as_str().to_string()),
        Expression::StaticMemberExpression(member) => {
            Some(member.property.name.as_str().to_string())
        }
        _ => None,
    }
}

pub fn initializer_records_from_declarator(
    view: &SourceView<'_>,
    declarator: &VariableDeclarator<'_>,
    imports: &SemanticImportIndex<'_>,
) -> Vec<StaticInitializerRecord> {
    initializer_records_from_declarator_with_index(view, declarator, imports, None)
}

pub(crate) fn initializer_records_from_declarator_with_index(
    view: &SourceView<'_>,
    declarator: &VariableDeclarator<'_>,
    imports: &SemanticImportIndex<'_>,
    initializer_index: Option<&SemanticInitializerIndex<'_>>,
) -> Vec<StaticInitializerRecord> {
    let Some(init) = &declarator.init else {
        return Vec::new();
    };
    let names = binding_names(&declarator.id);
    if names.is_empty() {
        return Vec::new();
    }
    let value = syntax_value_from_expression_with_index(view, init, imports, initializer_index);
    let source = view.location_for_span(init);
    let snippet = Some(view.snippet_for_span(init));
    names
        .into_iter()
        .map(|name| StaticInitializerRecord {
            name,
            value: value.clone(),
            source: source.clone(),
            snippet: snippet.clone(),
        })
        .collect()
}

fn syntax_value_from_expression_with_index(
    view: &SourceView<'_>,
    expression: &Expression<'_>,
    imports: &SemanticImportIndex<'_>,
    initializer_index: Option<&SemanticInitializerIndex<'_>>,
) -> StaticSyntaxValue {
    match expression {
        Expression::ArrowFunctionExpression(function) => {
            function_value_from_arrow(view, function, imports, initializer_index)
        }
        Expression::FunctionExpression(function) => function_value_from_function(
            view,
            function,
            imports,
            initializer_index,
            function.span(),
        ),
        Expression::ParenthesizedExpression(parenthesized) => {
            syntax_value_from_expression_with_index(
                view,
                &parenthesized.expression,
                imports,
                initializer_index,
            )
        }
        Expression::AwaitExpression(await_expression) => syntax_value_from_expression_with_index(
            view,
            &await_expression.argument,
            imports,
            initializer_index,
        ),
        _ => syntax_value_from_expression(view, expression, imports),
    }
}

pub fn call_args(
    view: &SourceView<'_>,
    args: &[Argument<'_>],
    imports: &SemanticImportIndex<'_>,
) -> Vec<StaticSyntaxValue> {
    args.iter()
        .map(|arg| argument_value(view, arg, imports))
        .collect()
}

pub fn binding_names(pattern: &BindingPattern<'_>) -> Vec<String> {
    match pattern {
        BindingPattern::BindingIdentifier(identifier) => vec![identifier.name.as_str().to_string()],
        BindingPattern::ObjectPattern(pattern) => pattern
            .properties
            .iter()
            .flat_map(|property| binding_names(&property.value))
            .chain(
                pattern
                    .rest
                    .iter()
                    .flat_map(|rest| binding_names(&rest.argument)),
            )
            .collect(),
        BindingPattern::ArrayPattern(pattern) => pattern
            .elements
            .iter()
            .flatten()
            .flat_map(binding_names)
            .chain(
                pattern
                    .rest
                    .iter()
                    .flat_map(|rest| binding_names(&rest.argument)),
            )
            .collect(),
        BindingPattern::AssignmentPattern(pattern) => binding_names(&pattern.left),
    }
}

pub(crate) fn call_receiver(
    view: &SourceView<'_>,
    callee: &Expression<'_>,
    imports: &SemanticImportIndex<'_>,
) -> Option<Box<StaticSyntaxValue>> {
    match callee {
        Expression::StaticMemberExpression(member) => Some(Box::new(syntax_value_from_expression(
            view,
            &member.object,
            imports,
        ))),
        _ => None,
    }
}

pub(crate) fn unsupported_value(
    view: &SourceView<'_>,
    span: Span,
    syntax_kind: &str,
) -> StaticSyntaxValue {
    StaticSyntaxValue::Unsupported {
        syntax_kind: syntax_kind.to_string(),
        source: view.location_for_offset(span.start as usize),
    }
}

fn syntax_kind_for_expression(expression: &Expression<'_>) -> &'static str {
    match expression {
        Expression::AssignmentExpression(_) => "BinaryExpression",
        Expression::ConditionalExpression(_) => "ConditionalExpression",
        Expression::NewExpression(_) => "NewExpression",
        Expression::JSXElement(_) => "JsxElement",
        Expression::JSXFragment(_) => "JsxFragment",
        _ => "Expression",
    }
}
