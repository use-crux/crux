use oxc_ast::ast::*;
use oxc_span::GetSpan;

use crate::{
    protocol::StaticSourceMatch,
    syntax::match_build::{MatchContext, should_skip_subtree},
    syntax::match_expressions::{visit_expression, visit_expression_call},
    syntax::match_statements::visit_statement,
};

pub(crate) fn visit_argument(
    context: MatchContext<'_, '_>,
    argument: &Argument<'_>,
    matches: &mut Vec<StaticSourceMatch>,
) {
    if should_skip_subtree(context, argument.span()) {
        return;
    }
    match argument {
        Argument::CallExpression(call) => visit_expression_call(context, call, matches),
        Argument::NewExpression(new_expression) => {
            visit_expression(context, &new_expression.callee, matches);
            for argument in &new_expression.arguments {
                visit_argument(context, argument, matches);
            }
        }
        Argument::SpreadElement(spread) => {
            visit_expression(context, &spread.argument, matches);
        }
        Argument::ObjectExpression(object) => {
            for property in &object.properties {
                match property {
                    ObjectPropertyKind::ObjectProperty(property) => {
                        visit_expression(context, &property.value, matches);
                    }
                    ObjectPropertyKind::SpreadProperty(spread) => {
                        visit_expression(context, &spread.argument, matches);
                    }
                }
            }
        }
        Argument::ArrayExpression(array) => {
            for element in &array.elements {
                visit_array_element(context, element, matches);
            }
        }
        Argument::ArrowFunctionExpression(function) => {
            let context = context.with_scope(function.scope_id.get().unwrap_or(context.scope_id));
            for statement in &function.body.statements {
                visit_statement(context, statement, false, matches);
            }
        }
        Argument::FunctionExpression(function) => {
            let context = context.with_scope(function.scope_id.get().unwrap_or(context.scope_id));
            if let Some(body) = &function.body {
                for statement in &body.statements {
                    visit_statement(context, statement, false, matches);
                }
            }
        }
        Argument::StaticMemberExpression(member) => {
            visit_expression(context, &member.object, matches);
        }
        Argument::AwaitExpression(await_expression) => {
            visit_expression(context, &await_expression.argument, matches);
        }
        Argument::ConditionalExpression(conditional) => {
            visit_expression(context, &conditional.test, matches);
            visit_expression(context, &conditional.consequent, matches);
            visit_expression(context, &conditional.alternate, matches);
        }
        Argument::ParenthesizedExpression(parenthesized) => {
            visit_expression(context, &parenthesized.expression, matches);
        }
        Argument::TSAsExpression(expression) => {
            visit_expression(context, &expression.expression, matches);
        }
        Argument::TSSatisfiesExpression(expression) => {
            visit_expression(context, &expression.expression, matches);
        }
        Argument::TSTypeAssertion(expression) => {
            visit_expression(context, &expression.expression, matches);
        }
        Argument::TSNonNullExpression(expression) => {
            visit_expression(context, &expression.expression, matches);
        }
        Argument::TSInstantiationExpression(expression) => {
            visit_expression(context, &expression.expression, matches);
        }
        _ => {}
    }
}

pub(crate) fn visit_array_element(
    context: MatchContext<'_, '_>,
    element: &ArrayExpressionElement<'_>,
    matches: &mut Vec<StaticSourceMatch>,
) {
    if should_skip_subtree(context, element.span()) {
        return;
    }
    match element {
        ArrayExpressionElement::CallExpression(call) => {
            visit_expression_call(context, call, matches);
        }
        ArrayExpressionElement::NewExpression(new_expression) => {
            visit_expression(context, &new_expression.callee, matches);
            for argument in &new_expression.arguments {
                visit_argument(context, argument, matches);
            }
        }
        ArrayExpressionElement::ObjectExpression(object) => {
            for property in &object.properties {
                match property {
                    ObjectPropertyKind::ObjectProperty(property) => {
                        visit_expression(context, &property.value, matches);
                    }
                    ObjectPropertyKind::SpreadProperty(spread) => {
                        visit_expression(context, &spread.argument, matches);
                    }
                }
            }
        }
        ArrayExpressionElement::ArrayExpression(array) => {
            for element in &array.elements {
                visit_array_element(context, element, matches);
            }
        }
        ArrayExpressionElement::SpreadElement(spread) => {
            visit_expression(context, &spread.argument, matches);
        }
        ArrayExpressionElement::ArrowFunctionExpression(function) => {
            let context = context.with_scope(function.scope_id.get().unwrap_or(context.scope_id));
            for statement in &function.body.statements {
                visit_statement(context, statement, false, matches);
            }
        }
        ArrayExpressionElement::FunctionExpression(function) => {
            let context = context.with_scope(function.scope_id.get().unwrap_or(context.scope_id));
            if let Some(body) = &function.body {
                for statement in &body.statements {
                    visit_statement(context, statement, false, matches);
                }
            }
        }
        ArrayExpressionElement::StaticMemberExpression(member) => {
            visit_expression(context, &member.object, matches);
        }
        ArrayExpressionElement::AwaitExpression(await_expression) => {
            visit_expression(context, &await_expression.argument, matches);
        }
        ArrayExpressionElement::ConditionalExpression(conditional) => {
            visit_expression(context, &conditional.test, matches);
            visit_expression(context, &conditional.consequent, matches);
            visit_expression(context, &conditional.alternate, matches);
        }
        ArrayExpressionElement::ParenthesizedExpression(parenthesized) => {
            visit_expression(context, &parenthesized.expression, matches);
        }
        ArrayExpressionElement::TSAsExpression(expression) => {
            visit_expression(context, &expression.expression, matches);
        }
        ArrayExpressionElement::TSSatisfiesExpression(expression) => {
            visit_expression(context, &expression.expression, matches);
        }
        ArrayExpressionElement::TSTypeAssertion(expression) => {
            visit_expression(context, &expression.expression, matches);
        }
        ArrayExpressionElement::TSNonNullExpression(expression) => {
            visit_expression(context, &expression.expression, matches);
        }
        ArrayExpressionElement::TSInstantiationExpression(expression) => {
            visit_expression(context, &expression.expression, matches);
        }
        _ => {}
    }
}
