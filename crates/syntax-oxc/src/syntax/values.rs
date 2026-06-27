use std::collections::HashMap;

use oxc_ast::ast::*;
use oxc_span::{GetSpan, Span};

use crate::{
    protocol::{
        LiteralValue, StaticCalleeRecord, StaticImportRecord, StaticInitializerRecord,
        StaticSyntaxValue,
    },
    syntax::argument_values::{argument_value, array_element_value, call_value},
    syntax::function_values::{function_value_from_arrow, function_value_from_function},
    syntax::source::SourceView,
};

pub(crate) use crate::syntax::object_values::{object_value, property_access_value};

type ImportsByLocalName = HashMap<String, StaticImportRecord>;

pub fn syntax_value_from_expression(
    view: &SourceView<'_>,
    expression: &Expression<'_>,
    imports: &ImportsByLocalName,
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
            function_value_from_arrow(view, function, imports)
        }
        Expression::FunctionExpression(function) => {
            function_value_from_function(view, function, imports, function.span())
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
    imports: &ImportsByLocalName,
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
    let import_lookup_name = import_lookup_name(expression).unwrap_or_else(|| local_name.clone());
    if let Some(imported) = imports.get(&import_lookup_name) {
        let member_import = matches!(expression, Expression::StaticMemberExpression(_));
        let imported_name = if member_import {
            local_name.clone()
        } else {
            imported.imported_name.clone()
        };
        return StaticCalleeRecord {
            name: imported_name.clone(),
            direct: Some(direct),
            local_name: Some(import_lookup_name),
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

fn import_lookup_name(expression: &Expression<'_>) -> Option<String> {
    match expression {
        Expression::Identifier(identifier) => Some(identifier.name.as_str().to_string()),
        Expression::StaticMemberExpression(member) => member_receiver_base_name(&member.object),
        _ => None,
    }
}

fn member_receiver_base_name(expression: &Expression<'_>) -> Option<String> {
    match expression {
        Expression::Identifier(identifier) => Some(identifier.name.as_str().to_string()),
        Expression::StaticMemberExpression(member) => member_receiver_base_name(&member.object),
        _ => None,
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
    imports: &ImportsByLocalName,
) -> Vec<StaticInitializerRecord> {
    let Some(init) = &declarator.init else {
        return Vec::new();
    };
    let names = binding_names(&declarator.id);
    if names.is_empty() {
        return Vec::new();
    }
    let value = syntax_value_from_expression(view, init, imports);
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

pub fn call_args(
    view: &SourceView<'_>,
    args: &[Argument<'_>],
    imports: &ImportsByLocalName,
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
    imports: &ImportsByLocalName,
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
