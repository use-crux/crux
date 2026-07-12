use oxc_ast::ast::*;
use oxc_span::GetSpan;

use crate::{
    protocol::StaticSourceMatch,
    syntax::match_arguments::{visit_argument, visit_array_element},
    syntax::match_build::{MatchContext, call_match, new_match, should_skip_subtree},
    syntax::match_statements::visit_statement,
    syntax::values::callee_record_from_expression,
};

pub(crate) fn visit_expression(
    context: MatchContext<'_, '_>,
    expression: &Expression<'_>,
    matches: &mut Vec<StaticSourceMatch>,
) {
    if should_skip_subtree(context, expression.span()) {
        return;
    }
    match expression {
        Expression::CallExpression(call) => {
            let callee = callee_record_from_expression(&call.callee, context.imports);
            if context.call_matcher.allows(&callee) {
                matches.push(call_match(
                    context,
                    format!(
                        "{}-{}",
                        callee.name,
                        context.view.location_for_span(&**call).line
                    ),
                    call,
                    false,
                ));
            }
            visit_expression(context, &call.callee, matches);
            for argument in &call.arguments {
                visit_argument(context, argument, matches);
            }
        }
        Expression::NewExpression(new_expression) => {
            if let Some(match_record) = new_match(
                context,
                format!(
                    "new-{}",
                    context.view.location_for_span(&**new_expression).line
                ),
                new_expression,
                false,
            ) {
                matches.push(match_record);
            }
            visit_expression(context, &new_expression.callee, matches);
            for argument in &new_expression.arguments {
                visit_argument(context, argument, matches);
            }
        }
        Expression::ObjectExpression(object) => {
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
        Expression::AwaitExpression(await_expression) => {
            visit_expression(context, &await_expression.argument, matches);
        }
        Expression::ConditionalExpression(conditional) => {
            visit_expression(context, &conditional.test, matches);
            visit_expression(context, &conditional.consequent, matches);
            visit_expression(context, &conditional.alternate, matches);
        }
        Expression::LogicalExpression(logical) => {
            visit_expression(context, &logical.left, matches);
            visit_expression(context, &logical.right, matches);
        }
        Expression::BinaryExpression(binary) => {
            visit_expression(context, &binary.left, matches);
            visit_expression(context, &binary.right, matches);
        }
        Expression::UnaryExpression(unary_expression) => {
            visit_expression(context, &unary_expression.argument, matches);
        }
        Expression::ParenthesizedExpression(parenthesized) => {
            visit_expression(context, &parenthesized.expression, matches);
        }
        Expression::TSAsExpression(expression) => {
            visit_expression(context, &expression.expression, matches);
        }
        Expression::TSSatisfiesExpression(expression) => {
            visit_expression(context, &expression.expression, matches);
        }
        Expression::TSTypeAssertion(expression) => {
            visit_expression(context, &expression.expression, matches);
        }
        Expression::TSNonNullExpression(expression) => {
            visit_expression(context, &expression.expression, matches);
        }
        Expression::TSInstantiationExpression(expression) => {
            visit_expression(context, &expression.expression, matches);
        }
        Expression::StaticMemberExpression(member) => {
            visit_expression(context, &member.object, matches);
        }
        Expression::ArrayExpression(array) => {
            for element in &array.elements {
                visit_array_element(context, element, matches);
            }
        }
        Expression::ArrowFunctionExpression(function) => {
            let context = context.with_scope(function.scope_id.get().unwrap_or(context.scope_id));
            for statement in &function.body.statements {
                visit_statement(context, statement, false, matches);
            }
        }
        Expression::FunctionExpression(function) => {
            let context = context.with_scope(function.scope_id.get().unwrap_or(context.scope_id));
            if let Some(body) = &function.body {
                for statement in &body.statements {
                    visit_statement(context, statement, false, matches);
                }
            }
        }
        _ => {}
    }
}

pub(crate) fn visit_expression_children(
    context: MatchContext<'_, '_>,
    expression: &Expression<'_>,
    matches: &mut Vec<StaticSourceMatch>,
) {
    match expression {
        Expression::CallExpression(call) => {
            visit_expression(context, &call.callee, matches);
            for argument in &call.arguments {
                visit_argument(context, argument, matches);
            }
        }
        Expression::NewExpression(expression) => {
            visit_expression(context, &expression.callee, matches);
            for argument in &expression.arguments {
                visit_argument(context, argument, matches);
            }
        }
        Expression::ObjectExpression(object) => {
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
        _ => {}
    }
}

pub(crate) fn visit_expression_call(
    context: MatchContext<'_, '_>,
    call: &CallExpression<'_>,
    matches: &mut Vec<StaticSourceMatch>,
) {
    let callee = callee_record_from_expression(&call.callee, context.imports);
    if context.call_matcher.allows(&callee) {
        matches.push(call_match(
            context,
            format!(
                "{}-{}",
                callee.name,
                context.view.location_for_span(call).line
            ),
            call,
            false,
        ));
    }
    visit_expression(context, &call.callee, matches);
    for argument in &call.arguments {
        visit_argument(context, argument, matches);
    }
}
