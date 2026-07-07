use oxc_ast::ast::*;
use oxc_span::GetSpan;

use crate::{
    protocol::{LiteralValue, StaticSyntaxValue},
    syntax::function_values::{function_value_from_arrow, function_value_from_function},
    syntax::semantic_imports::SemanticImportIndex,
    syntax::source::SourceView,
    syntax::values::{
        call_args, call_receiver, callee_record_from_expression, object_value,
        property_access_value, syntax_value_from_expression, unsupported_value,
    },
};

pub(crate) fn argument_value(
    view: &SourceView<'_>,
    argument: &Argument<'_>,
    imports: &SemanticImportIndex<'_>,
) -> StaticSyntaxValue {
    match argument {
        Argument::StringLiteral(literal) => StaticSyntaxValue::Literal {
            value: LiteralValue::String(literal.value.as_str().to_string()),
        },
        Argument::NumericLiteral(literal) => StaticSyntaxValue::Literal {
            value: LiteralValue::Number(literal.value),
        },
        Argument::BooleanLiteral(literal) => StaticSyntaxValue::Literal {
            value: LiteralValue::Boolean(literal.value),
        },
        Argument::NullLiteral(_) => StaticSyntaxValue::Literal {
            value: LiteralValue::Null,
        },
        Argument::Identifier(identifier) => StaticSyntaxValue::Identifier {
            name: identifier.name.as_str().to_string(),
        },
        Argument::StaticMemberExpression(member) => property_access_value(member),
        Argument::ObjectExpression(object) => object_value(view, object, imports),
        Argument::ArrayExpression(array) => StaticSyntaxValue::Array {
            elements: array
                .elements
                .iter()
                .filter_map(|element| array_element_value(view, element, imports))
                .collect(),
        },
        Argument::CallExpression(call) => call_value(view, call, imports),
        Argument::TemplateLiteral(template) => StaticSyntaxValue::Template {
            text: view.text_for_span(&**template),
            expressions: template
                .expressions
                .iter()
                .map(|expression| syntax_value_from_expression(view, expression, imports))
                .collect(),
        },
        Argument::AwaitExpression(await_expression) => {
            syntax_value_from_expression(view, &await_expression.argument, imports)
        }
        Argument::ParenthesizedExpression(parenthesized) => {
            syntax_value_from_expression(view, &parenthesized.expression, imports)
        }
        Argument::ArrowFunctionExpression(function) => {
            function_value_from_arrow(view, function, imports, None)
        }
        Argument::FunctionExpression(function) => {
            function_value_from_function(view, function, imports, None, function.span())
        }
        Argument::LogicalExpression(_) | Argument::BinaryExpression(_) => {
            unsupported_value(view, argument.span(), "BinaryExpression")
        }
        _ => unsupported_value(view, argument.span(), syntax_kind_for_argument(argument)),
    }
}

pub(crate) fn array_element_value(
    view: &SourceView<'_>,
    element: &ArrayExpressionElement<'_>,
    imports: &SemanticImportIndex<'_>,
) -> Option<StaticSyntaxValue> {
    match element {
        ArrayExpressionElement::Elision(_) => None,
        ArrayExpressionElement::SpreadElement(spread) => {
            Some(unsupported_value(view, spread.span(), "SpreadElement"))
        }
        ArrayExpressionElement::StringLiteral(literal) => Some(StaticSyntaxValue::Literal {
            value: LiteralValue::String(literal.value.as_str().to_string()),
        }),
        ArrayExpressionElement::NumericLiteral(literal) => Some(StaticSyntaxValue::Literal {
            value: LiteralValue::Number(literal.value),
        }),
        ArrayExpressionElement::BooleanLiteral(literal) => Some(StaticSyntaxValue::Literal {
            value: LiteralValue::Boolean(literal.value),
        }),
        ArrayExpressionElement::NullLiteral(_) => Some(StaticSyntaxValue::Literal {
            value: LiteralValue::Null,
        }),
        ArrayExpressionElement::Identifier(identifier) => Some(StaticSyntaxValue::Identifier {
            name: identifier.name.as_str().to_string(),
        }),
        ArrayExpressionElement::StaticMemberExpression(member) => {
            Some(property_access_value(member))
        }
        ArrayExpressionElement::ObjectExpression(object) => {
            Some(object_value(view, object, imports))
        }
        ArrayExpressionElement::ArrayExpression(array) => Some(StaticSyntaxValue::Array {
            elements: array
                .elements
                .iter()
                .filter_map(|element| array_element_value(view, element, imports))
                .collect(),
        }),
        ArrayExpressionElement::CallExpression(call) => Some(call_value(view, call, imports)),
        ArrayExpressionElement::TemplateLiteral(template) => Some(StaticSyntaxValue::Template {
            text: view.text_for_span(&**template),
            expressions: template
                .expressions
                .iter()
                .map(|expression| syntax_value_from_expression(view, expression, imports))
                .collect(),
        }),
        ArrayExpressionElement::AwaitExpression(await_expression) => Some(
            syntax_value_from_expression(view, &await_expression.argument, imports),
        ),
        ArrayExpressionElement::ParenthesizedExpression(parenthesized) => Some(
            syntax_value_from_expression(view, &parenthesized.expression, imports),
        ),
        ArrayExpressionElement::ArrowFunctionExpression(function) => {
            Some(function_value_from_arrow(view, function, imports, None))
        }
        ArrayExpressionElement::FunctionExpression(function) => Some(function_value_from_function(
            view,
            function,
            imports,
            None,
            function.span(),
        )),
        ArrayExpressionElement::LogicalExpression(_)
        | ArrayExpressionElement::BinaryExpression(_) => {
            Some(unsupported_value(view, element.span(), "BinaryExpression"))
        }
        _ => Some(unsupported_value(
            view,
            element.span(),
            syntax_kind_for_array_element(element),
        )),
    }
}

pub(crate) fn call_value(
    view: &SourceView<'_>,
    call: &CallExpression<'_>,
    imports: &SemanticImportIndex<'_>,
) -> StaticSyntaxValue {
    StaticSyntaxValue::Call {
        callee: callee_record_from_expression(&call.callee, imports),
        receiver: call_receiver(view, &call.callee, imports),
        args: call_args(view, &call.arguments, imports),
        source: view.location_for_span(call),
        snippet: Some(view.snippet_for_span(call)),
    }
}

fn syntax_kind_for_argument(argument: &Argument<'_>) -> &'static str {
    match argument {
        Argument::SpreadElement(_) => "SpreadElement",
        Argument::NewExpression(_) => "NewExpression",
        _ => "Expression",
    }
}

fn syntax_kind_for_array_element(element: &ArrayExpressionElement<'_>) -> &'static str {
    match element {
        ArrayExpressionElement::SpreadElement(_) => "SpreadElement",
        ArrayExpressionElement::NewExpression(_) => "NewExpression",
        _ => "Expression",
    }
}
