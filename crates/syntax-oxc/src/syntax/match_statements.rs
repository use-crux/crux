use std::collections::HashMap;

use oxc_ast::ast::*;

use crate::{
    protocol::{StaticImportRecord, StaticInitializerRecord, StaticSourceMatch},
    syntax::initializers::scoped_initializers_for_function,
    syntax::match_build::{MatchContext, match_from_declarator, new_match, traversal_needles},
    syntax::match_expressions::{visit_expression, visit_expression_call},
    syntax::match_interests::CalleeMatcher,
    syntax::source::SourceView,
};

pub(crate) fn collect_matches(
    root: &str,
    file: &str,
    view: &SourceView<'_>,
    statements: &[Statement<'_>],
    imports: &HashMap<String, StaticImportRecord>,
    call_matcher: &CalleeMatcher,
    constructor_matcher: &CalleeMatcher,
) -> Vec<StaticSourceMatch> {
    let mut matches = Vec::new();
    let traversal_needles =
        traversal_needles(call_matcher.names(), constructor_matcher.names(), imports);
    let needle_index = view.needle_index(&traversal_needles);
    for statement in statements {
        visit_statement(
            MatchContext {
                root,
                file,
                view,
                imports,
                call_matcher,
                constructor_matcher,
                needle_index: &needle_index,
            },
            statement,
            false,
            &[],
            &mut matches,
        );
    }
    matches
}

pub(crate) fn visit_statement(
    context: MatchContext<'_, '_>,
    statement: &Statement<'_>,
    exported: bool,
    scoped_initializers: &[StaticInitializerRecord],
    matches: &mut Vec<StaticSourceMatch>,
) {
    match statement {
        Statement::ExportNamedDeclaration(export) => {
            if let Some(declaration) = &export.declaration {
                visit_declaration(context, declaration, true, scoped_initializers, matches);
            }
        }
        Statement::ExportDefaultDeclaration(export) => {
            visit_export_default(context, &export.declaration, scoped_initializers, matches);
        }
        Statement::VariableDeclaration(declaration) => {
            for declarator in &declaration.declarations {
                visit_variable_declarator(
                    context,
                    declarator,
                    exported,
                    scoped_initializers,
                    matches,
                );
            }
        }
        Statement::FunctionDeclaration(function) => {
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
        Statement::ExpressionStatement(statement) => {
            visit_expression(context, &statement.expression, scoped_initializers, matches);
        }
        Statement::ReturnStatement(statement) => {
            if let Some(argument) = &statement.argument {
                visit_expression(context, argument, scoped_initializers, matches);
            }
        }
        Statement::BlockStatement(block) => {
            for statement in &block.body {
                visit_statement(context, statement, false, scoped_initializers, matches);
            }
        }
        Statement::IfStatement(statement) => {
            visit_expression(context, &statement.test, scoped_initializers, matches);
            visit_statement(
                context,
                &statement.consequent,
                false,
                scoped_initializers,
                matches,
            );
            if let Some(alternate) = &statement.alternate {
                visit_statement(context, alternate, false, scoped_initializers, matches);
            }
        }
        _ => {}
    }
}

fn visit_declaration(
    context: MatchContext<'_, '_>,
    declaration: &Declaration<'_>,
    exported: bool,
    scoped_initializers: &[StaticInitializerRecord],
    matches: &mut Vec<StaticSourceMatch>,
) {
    match declaration {
        Declaration::VariableDeclaration(declaration) => {
            for declarator in &declaration.declarations {
                visit_variable_declarator(
                    context,
                    declarator,
                    exported,
                    scoped_initializers,
                    matches,
                );
            }
        }
        Declaration::FunctionDeclaration(function) => {
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

fn visit_variable_declarator(
    context: MatchContext<'_, '_>,
    declarator: &VariableDeclarator<'_>,
    exported: bool,
    scoped_initializers: &[StaticInitializerRecord],
    matches: &mut Vec<StaticSourceMatch>,
) {
    if let Some(match_record) =
        match_from_declarator(context, declarator, exported, scoped_initializers)
    {
        matches.push(match_record);
        return;
    }
    visit_binding_pattern(context, &declarator.id, scoped_initializers, matches);
    if let Some(init) = &declarator.init {
        visit_expression(context, init, scoped_initializers, matches);
    }
}

fn visit_binding_pattern(
    context: MatchContext<'_, '_>,
    pattern: &BindingPattern<'_>,
    scoped_initializers: &[StaticInitializerRecord],
    matches: &mut Vec<StaticSourceMatch>,
) {
    match pattern {
        BindingPattern::ObjectPattern(pattern) => {
            for property in &pattern.properties {
                visit_binding_pattern(context, &property.value, scoped_initializers, matches);
            }
            if let Some(rest) = &pattern.rest {
                visit_binding_pattern(context, &rest.argument, scoped_initializers, matches);
            }
        }
        BindingPattern::ArrayPattern(pattern) => {
            for element in pattern.elements.iter().flatten() {
                visit_binding_pattern(context, element, scoped_initializers, matches);
            }
            if let Some(rest) = &pattern.rest {
                visit_binding_pattern(context, &rest.argument, scoped_initializers, matches);
            }
        }
        BindingPattern::AssignmentPattern(pattern) => {
            visit_binding_pattern(context, &pattern.left, scoped_initializers, matches);
            visit_expression(context, &pattern.right, scoped_initializers, matches);
        }
        BindingPattern::BindingIdentifier(_) => {}
    }
}

fn visit_export_default(
    context: MatchContext<'_, '_>,
    declaration: &ExportDefaultDeclarationKind<'_>,
    scoped_initializers: &[StaticInitializerRecord],
    matches: &mut Vec<StaticSourceMatch>,
) {
    match declaration {
        ExportDefaultDeclarationKind::CallExpression(call) => {
            visit_expression_call(context, call, scoped_initializers, matches);
        }
        ExportDefaultDeclarationKind::NewExpression(new_expression) => {
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
        }
        ExportDefaultDeclarationKind::FunctionDeclaration(function) => {
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
