use oxc_ast::ast::*;
use oxc_span::GetSpan;

use crate::{
    initializers::{scoped_initializers_for_arrow, scoped_initializers_for_function},
    match_build::{MatchContext, should_skip_subtree},
    match_expressions::{visit_expression, visit_expression_call},
    match_statements::visit_statement,
    protocol::{StaticInitializerRecord, StaticSourceMatch},
};

pub(crate) fn visit_argument(
    context: MatchContext<'_, '_>,
    argument: &Argument<'_>,
    scoped_initializers: &[StaticInitializerRecord],
    matches: &mut Vec<StaticSourceMatch>,
) {
    if should_skip_subtree(context, argument.span()) {
        return;
    }
    match argument {
        Argument::CallExpression(call) => {
            visit_expression_call(context, call, scoped_initializers, matches)
        }
        Argument::ObjectExpression(object) => {
            for property in &object.properties {
                if let ObjectPropertyKind::ObjectProperty(property) = property {
                    visit_expression(context, &property.value, scoped_initializers, matches);
                }
            }
        }
        Argument::ArrayExpression(array) => {
            for element in &array.elements {
                visit_array_element(context, element, scoped_initializers, matches);
            }
        }
        Argument::ArrowFunctionExpression(function) => {
            let scoped = scoped_initializers_for_arrow(
                context.view,
                function,
                context.imports,
                scoped_initializers,
            );
            for statement in &function.body.statements {
                visit_statement(context, statement, false, &scoped, matches);
            }
        }
        Argument::FunctionExpression(function) => {
            let scoped = scoped_initializers_for_function(
                context.view,
                function,
                context.imports,
                scoped_initializers,
            );
            if let Some(body) = &function.body {
                for statement in &body.statements {
                    visit_statement(context, statement, false, &scoped, matches);
                }
            }
        }
        Argument::StaticMemberExpression(member) => {
            visit_expression(context, &member.object, scoped_initializers, matches);
        }
        Argument::AwaitExpression(await_expression) => {
            visit_expression(
                context,
                &await_expression.argument,
                scoped_initializers,
                matches,
            );
        }
        Argument::ParenthesizedExpression(parenthesized) => {
            visit_expression(
                context,
                &parenthesized.expression,
                scoped_initializers,
                matches,
            );
        }
        _ => {}
    }
}

pub(crate) fn visit_array_element(
    context: MatchContext<'_, '_>,
    element: &ArrayExpressionElement<'_>,
    scoped_initializers: &[StaticInitializerRecord],
    matches: &mut Vec<StaticSourceMatch>,
) {
    if should_skip_subtree(context, element.span()) {
        return;
    }
    match element {
        ArrayExpressionElement::CallExpression(call) => {
            visit_expression_call(context, call, scoped_initializers, matches);
        }
        ArrayExpressionElement::ObjectExpression(object) => {
            for property in &object.properties {
                if let ObjectPropertyKind::ObjectProperty(property) = property {
                    visit_expression(context, &property.value, scoped_initializers, matches);
                }
            }
        }
        ArrayExpressionElement::ArrayExpression(array) => {
            for element in &array.elements {
                visit_array_element(context, element, scoped_initializers, matches);
            }
        }
        ArrayExpressionElement::SpreadElement(spread) => {
            visit_expression(context, &spread.argument, scoped_initializers, matches);
        }
        ArrayExpressionElement::ArrowFunctionExpression(function) => {
            let scoped = scoped_initializers_for_arrow(
                context.view,
                function,
                context.imports,
                scoped_initializers,
            );
            for statement in &function.body.statements {
                visit_statement(context, statement, false, &scoped, matches);
            }
        }
        ArrayExpressionElement::FunctionExpression(function) => {
            let scoped = scoped_initializers_for_function(
                context.view,
                function,
                context.imports,
                scoped_initializers,
            );
            if let Some(body) = &function.body {
                for statement in &body.statements {
                    visit_statement(context, statement, false, &scoped, matches);
                }
            }
        }
        ArrayExpressionElement::StaticMemberExpression(member) => {
            visit_expression(context, &member.object, scoped_initializers, matches);
        }
        ArrayExpressionElement::AwaitExpression(await_expression) => {
            visit_expression(
                context,
                &await_expression.argument,
                scoped_initializers,
                matches,
            );
        }
        ArrayExpressionElement::ParenthesizedExpression(parenthesized) => {
            visit_expression(
                context,
                &parenthesized.expression,
                scoped_initializers,
                matches,
            );
        }
        _ => {}
    }
}
