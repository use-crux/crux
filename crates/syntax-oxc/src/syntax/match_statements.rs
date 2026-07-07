use oxc_ast::ast::*;
use oxc_semantic::Scoping;

use crate::{
    protocol::StaticSourceMatch,
    syntax::match_build::{MatchContext, match_from_declarator, new_match, traversal_needles},
    syntax::match_expressions::{visit_expression, visit_expression_call},
    syntax::match_interests::CalleeMatcher,
    syntax::semantic_imports::SemanticImportIndex,
    syntax::semantic_initializers::SemanticInitializerIndex,
    syntax::source::SourceView,
};

pub(crate) fn collect_matches(
    root: &str,
    file: &str,
    view: &SourceView<'_>,
    scoping: &Scoping,
    initializer_index: &SemanticInitializerIndex<'_>,
    statements: &[Statement<'_>],
    imports: &SemanticImportIndex<'_>,
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
                initializer_index,
                scope_id: scoping.root_scope_id(),
                imports,
                call_matcher,
                constructor_matcher,
                needle_index: &needle_index,
            },
            statement,
            false,
            &mut matches,
        );
    }
    matches
}

pub(crate) fn visit_statement(
    context: MatchContext<'_, '_>,
    statement: &Statement<'_>,
    exported: bool,
    matches: &mut Vec<StaticSourceMatch>,
) {
    match statement {
        Statement::ExportNamedDeclaration(export) => {
            if let Some(declaration) = &export.declaration {
                visit_declaration(context, declaration, true, matches);
            }
        }
        Statement::ExportDefaultDeclaration(export) => {
            visit_export_default(context, &export.declaration, matches);
        }
        Statement::VariableDeclaration(declaration) => {
            for declarator in &declaration.declarations {
                visit_variable_declarator(context, declarator, exported, matches);
            }
        }
        Statement::FunctionDeclaration(function) => {
            let context = context.with_scope(function.scope_id.get().unwrap_or(context.scope_id));
            if let Some(body) = &function.body {
                for statement in &body.statements {
                    visit_statement(context, statement, false, matches);
                }
            }
        }
        Statement::ExpressionStatement(statement) => {
            visit_expression(context, &statement.expression, matches);
        }
        Statement::ReturnStatement(statement) => {
            if let Some(argument) = &statement.argument {
                visit_expression(context, argument, matches);
            }
        }
        Statement::BlockStatement(block) => {
            let context = context.with_scope(block.scope_id.get().unwrap_or(context.scope_id));
            for statement in &block.body {
                visit_statement(context, statement, false, matches);
            }
        }
        Statement::IfStatement(statement) => {
            visit_expression(context, &statement.test, matches);
            visit_statement(context, &statement.consequent, false, matches);
            if let Some(alternate) = &statement.alternate {
                visit_statement(context, alternate, false, matches);
            }
        }
        _ => {}
    }
}

fn visit_declaration(
    context: MatchContext<'_, '_>,
    declaration: &Declaration<'_>,
    exported: bool,
    matches: &mut Vec<StaticSourceMatch>,
) {
    match declaration {
        Declaration::VariableDeclaration(declaration) => {
            for declarator in &declaration.declarations {
                visit_variable_declarator(context, declarator, exported, matches);
            }
        }
        Declaration::FunctionDeclaration(function) => {
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

fn visit_variable_declarator(
    context: MatchContext<'_, '_>,
    declarator: &VariableDeclarator<'_>,
    exported: bool,
    matches: &mut Vec<StaticSourceMatch>,
) {
    if let Some(match_record) = match_from_declarator(context, declarator, exported) {
        matches.push(match_record);
        return;
    }
    visit_binding_pattern(context, &declarator.id, matches);
    if let Some(init) = &declarator.init {
        visit_expression(context, init, matches);
    }
}

fn visit_binding_pattern(
    context: MatchContext<'_, '_>,
    pattern: &BindingPattern<'_>,
    matches: &mut Vec<StaticSourceMatch>,
) {
    match pattern {
        BindingPattern::ObjectPattern(pattern) => {
            for property in &pattern.properties {
                visit_binding_pattern(context, &property.value, matches);
            }
            if let Some(rest) = &pattern.rest {
                visit_binding_pattern(context, &rest.argument, matches);
            }
        }
        BindingPattern::ArrayPattern(pattern) => {
            for element in pattern.elements.iter().flatten() {
                visit_binding_pattern(context, element, matches);
            }
            if let Some(rest) = &pattern.rest {
                visit_binding_pattern(context, &rest.argument, matches);
            }
        }
        BindingPattern::AssignmentPattern(pattern) => {
            visit_binding_pattern(context, &pattern.left, matches);
            visit_expression(context, &pattern.right, matches);
        }
        BindingPattern::BindingIdentifier(_) => {}
    }
}

fn visit_export_default(
    context: MatchContext<'_, '_>,
    declaration: &ExportDefaultDeclarationKind<'_>,
    matches: &mut Vec<StaticSourceMatch>,
) {
    match declaration {
        ExportDefaultDeclarationKind::CallExpression(call) => {
            visit_expression_call(context, call, matches);
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
            ) {
                matches.push(match_record);
            }
        }
        ExportDefaultDeclarationKind::FunctionDeclaration(function) => {
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
