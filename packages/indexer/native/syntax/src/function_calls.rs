use std::collections::HashMap;

use oxc_ast::ast::*;

use crate::{
    protocol::{StaticFunctionCallValue, StaticImportRecord},
    source::SourceView,
    values::{call_args, call_receiver, callee_record_from_expression},
};

type ImportsByLocalName = HashMap<String, StaticImportRecord>;

pub(crate) fn function_calls_from_statements(
    view: &SourceView<'_>,
    statements: &[Statement<'_>],
    imports: &ImportsByLocalName,
) -> Vec<StaticFunctionCallValue> {
    let mut calls = Vec::new();
    for statement in statements {
        collect_calls_from_statement(view, statement, imports, &mut calls);
    }
    calls
}

fn collect_calls_from_statement(
    view: &SourceView<'_>,
    statement: &Statement<'_>,
    imports: &ImportsByLocalName,
    calls: &mut Vec<StaticFunctionCallValue>,
) {
    match statement {
        Statement::ExpressionStatement(statement) => {
            collect_calls_from_expression(view, &statement.expression, imports, calls);
        }
        Statement::ReturnStatement(statement) => {
            if let Some(argument) = &statement.argument {
                collect_calls_from_expression(view, argument, imports, calls);
            }
        }
        Statement::BlockStatement(block) => {
            for statement in &block.body {
                collect_calls_from_statement(view, statement, imports, calls);
            }
        }
        Statement::IfStatement(statement) => {
            collect_calls_from_expression(view, &statement.test, imports, calls);
            collect_calls_from_statement(view, &statement.consequent, imports, calls);
            if let Some(alternate) = &statement.alternate {
                collect_calls_from_statement(view, alternate, imports, calls);
            }
        }
        Statement::VariableDeclaration(declaration) => {
            for declarator in &declaration.declarations {
                if let Some(init) = &declarator.init {
                    collect_calls_from_expression(view, init, imports, calls);
                }
            }
        }
        Statement::FunctionDeclaration(function) => {
            if let Some(body) = &function.body {
                for statement in &body.statements {
                    collect_calls_from_statement(view, statement, imports, calls);
                }
            }
        }
        _ => {}
    }
}

fn collect_calls_from_expression(
    view: &SourceView<'_>,
    expression: &Expression<'_>,
    imports: &ImportsByLocalName,
    calls: &mut Vec<StaticFunctionCallValue>,
) {
    match expression {
        Expression::CallExpression(call) => {
            calls.push(call_value(view, call, imports));
            collect_calls_from_expression(view, &call.callee, imports, calls);
            for argument in &call.arguments {
                collect_calls_from_argument(view, argument, imports, calls);
            }
        }
        Expression::ObjectExpression(object) => {
            for property in &object.properties {
                if let ObjectPropertyKind::ObjectProperty(property) = property {
                    collect_calls_from_expression(view, &property.value, imports, calls);
                }
            }
        }
        Expression::ArrayExpression(array) => {
            for element in &array.elements {
                collect_calls_from_array_element(view, element, imports, calls);
            }
        }
        Expression::ArrowFunctionExpression(function) => {
            for statement in &function.body.statements {
                collect_calls_from_statement(view, statement, imports, calls);
            }
        }
        Expression::FunctionExpression(function) => {
            if let Some(body) = &function.body {
                for statement in &body.statements {
                    collect_calls_from_statement(view, statement, imports, calls);
                }
            }
        }
        Expression::StaticMemberExpression(member) => {
            collect_calls_from_expression(view, &member.object, imports, calls);
        }
        Expression::AwaitExpression(await_expression) => {
            collect_calls_from_expression(view, &await_expression.argument, imports, calls);
        }
        Expression::LogicalExpression(expression) => {
            collect_calls_from_expression(view, &expression.left, imports, calls);
            collect_calls_from_expression(view, &expression.right, imports, calls);
        }
        Expression::BinaryExpression(expression) => {
            collect_calls_from_expression(view, &expression.left, imports, calls);
            collect_calls_from_expression(view, &expression.right, imports, calls);
        }
        Expression::ConditionalExpression(expression) => {
            collect_calls_from_expression(view, &expression.test, imports, calls);
            collect_calls_from_expression(view, &expression.consequent, imports, calls);
            collect_calls_from_expression(view, &expression.alternate, imports, calls);
        }
        Expression::ParenthesizedExpression(parenthesized) => {
            collect_calls_from_expression(view, &parenthesized.expression, imports, calls);
        }
        _ => {}
    }
}

fn collect_calls_from_argument(
    view: &SourceView<'_>,
    argument: &Argument<'_>,
    imports: &ImportsByLocalName,
    calls: &mut Vec<StaticFunctionCallValue>,
) {
    match argument {
        Argument::CallExpression(call) => {
            calls.push(call_value(view, call, imports));
            collect_calls_from_expression(view, &call.callee, imports, calls);
            for argument in &call.arguments {
                collect_calls_from_argument(view, argument, imports, calls);
            }
        }
        Argument::ObjectExpression(object) => {
            for property in &object.properties {
                if let ObjectPropertyKind::ObjectProperty(property) = property {
                    collect_calls_from_expression(view, &property.value, imports, calls);
                }
            }
        }
        Argument::ArrayExpression(array) => {
            for element in &array.elements {
                collect_calls_from_array_element(view, element, imports, calls);
            }
        }
        Argument::ArrowFunctionExpression(function) => {
            for statement in &function.body.statements {
                collect_calls_from_statement(view, statement, imports, calls);
            }
        }
        Argument::FunctionExpression(function) => {
            if let Some(body) = &function.body {
                for statement in &body.statements {
                    collect_calls_from_statement(view, statement, imports, calls);
                }
            }
        }
        Argument::StaticMemberExpression(member) => {
            collect_calls_from_expression(view, &member.object, imports, calls);
        }
        Argument::AwaitExpression(await_expression) => {
            collect_calls_from_expression(view, &await_expression.argument, imports, calls);
        }
        Argument::ParenthesizedExpression(parenthesized) => {
            collect_calls_from_expression(view, &parenthesized.expression, imports, calls);
        }
        _ => {}
    }
}

fn collect_calls_from_array_element(
    view: &SourceView<'_>,
    element: &ArrayExpressionElement<'_>,
    imports: &ImportsByLocalName,
    calls: &mut Vec<StaticFunctionCallValue>,
) {
    match element {
        ArrayExpressionElement::CallExpression(call) => {
            calls.push(call_value(view, call, imports));
            collect_calls_from_expression(view, &call.callee, imports, calls);
            for argument in &call.arguments {
                collect_calls_from_argument(view, argument, imports, calls);
            }
        }
        ArrayExpressionElement::ObjectExpression(object) => {
            for property in &object.properties {
                if let ObjectPropertyKind::ObjectProperty(property) = property {
                    collect_calls_from_expression(view, &property.value, imports, calls);
                }
            }
        }
        ArrayExpressionElement::ArrayExpression(array) => {
            for element in &array.elements {
                collect_calls_from_array_element(view, element, imports, calls);
            }
        }
        ArrayExpressionElement::ArrowFunctionExpression(function) => {
            for statement in &function.body.statements {
                collect_calls_from_statement(view, statement, imports, calls);
            }
        }
        ArrayExpressionElement::FunctionExpression(function) => {
            if let Some(body) = &function.body {
                for statement in &body.statements {
                    collect_calls_from_statement(view, statement, imports, calls);
                }
            }
        }
        ArrayExpressionElement::StaticMemberExpression(member) => {
            collect_calls_from_expression(view, &member.object, imports, calls);
        }
        ArrayExpressionElement::AwaitExpression(await_expression) => {
            collect_calls_from_expression(view, &await_expression.argument, imports, calls);
        }
        ArrayExpressionElement::ParenthesizedExpression(parenthesized) => {
            collect_calls_from_expression(view, &parenthesized.expression, imports, calls);
        }
        ArrayExpressionElement::SpreadElement(spread) => {
            collect_calls_from_expression(view, &spread.argument, imports, calls);
        }
        _ => {}
    }
}

fn call_value(
    view: &SourceView<'_>,
    call: &CallExpression<'_>,
    imports: &ImportsByLocalName,
) -> StaticFunctionCallValue {
    StaticFunctionCallValue {
        callee: callee_record_from_expression(&call.callee, imports),
        receiver: call_receiver(view, &call.callee, imports),
        args: call_args(view, &call.arguments, imports),
        source: view.location_for_span(call),
        snippet: Some(view.snippet_for_span(call)),
    }
}
