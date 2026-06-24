use oxc_ast::ast::*;
use oxc_span::GetSpan;

use crate::{
    protocol::{StaticInitializerRecord, StaticSourceMatch},
    syntax::initializers::{scoped_initializers_for_arrow, scoped_initializers_for_function},
    syntax::match_arguments::{visit_argument, visit_array_element},
    syntax::match_build::{MatchContext, call_match, new_match, should_skip_subtree},
    syntax::match_statements::visit_statement,
    syntax::values::callee_record_from_expression,
};

pub(crate) fn visit_expression(
    context: MatchContext<'_, '_>,
    expression: &Expression<'_>,
    scoped_initializers: &[StaticInitializerRecord],
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
                    scoped_initializers,
                ));
            }
            visit_expression(context, &call.callee, scoped_initializers, matches);
            for argument in &call.arguments {
                visit_argument(context, argument, scoped_initializers, matches);
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
                scoped_initializers,
            ) {
                matches.push(match_record);
            }
            visit_expression(
                context,
                &new_expression.callee,
                scoped_initializers,
                matches,
            );
            for argument in &new_expression.arguments {
                visit_argument(context, argument, scoped_initializers, matches);
            }
        }
        Expression::ObjectExpression(object) => {
            for property in &object.properties {
                match property {
                    ObjectPropertyKind::ObjectProperty(property) => {
                        visit_expression(context, &property.value, scoped_initializers, matches);
                    }
                    ObjectPropertyKind::SpreadProperty(spread) => {
                        visit_expression(context, &spread.argument, scoped_initializers, matches);
                    }
                }
            }
        }
        Expression::AwaitExpression(await_expression) => {
            visit_expression(
                context,
                &await_expression.argument,
                scoped_initializers,
                matches,
            );
        }
        Expression::UnaryExpression(unary_expression) => {
            visit_expression(
                context,
                &unary_expression.argument,
                scoped_initializers,
                matches,
            );
        }
        Expression::ParenthesizedExpression(parenthesized) => {
            visit_expression(
                context,
                &parenthesized.expression,
                scoped_initializers,
                matches,
            );
        }
        Expression::StaticMemberExpression(member) => {
            visit_expression(context, &member.object, scoped_initializers, matches);
        }
        Expression::ArrayExpression(array) => {
            for element in &array.elements {
                visit_array_element(context, element, scoped_initializers, matches);
            }
        }
        Expression::ArrowFunctionExpression(function) => {
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
        Expression::FunctionExpression(function) => {
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
        _ => {}
    }
}

pub(crate) fn visit_expression_call(
    context: MatchContext<'_, '_>,
    call: &CallExpression<'_>,
    scoped_initializers: &[StaticInitializerRecord],
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
            scoped_initializers,
        ));
    }
    visit_expression(context, &call.callee, scoped_initializers, matches);
    for argument in &call.arguments {
        visit_argument(context, argument, scoped_initializers, matches);
    }
}
