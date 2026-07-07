//! AST walk that records initializer declarations by semantic scope.
use std::collections::HashMap;

use oxc_ast::ast::*;
use oxc_semantic::{ScopeId, Scoping};
use oxc_span::GetSpan;

use crate::syntax::{
    binding_symbols::binding_symbol_ids, semantic_imports::SemanticImportIndex,
    semantic_initializers::ScopedInitializer, source::SourceView,
    values::initializer_records_from_declarator,
};
type InitializersByScope = HashMap<ScopeId, Vec<ScopedInitializer>>;

pub(super) fn collect_semantic_initializers(
    scoping: &Scoping,
    view: &SourceView<'_>,
    program: &Program<'_>,
    imports: &SemanticImportIndex<'_>,
) -> InitializersByScope {
    let root_scope = program
        .scope_id
        .get()
        .unwrap_or_else(|| scoping.root_scope_id());
    let mut walk = InitializerWalk {
        scoping,
        by_scope: HashMap::new(),
    };
    walk.statements(view, &program.body, root_scope, imports);
    walk.by_scope
}

struct InitializerWalk<'a> {
    scoping: &'a Scoping,
    by_scope: InitializersByScope,
}

impl InitializerWalk<'_> {
    fn statements(
        &mut self,
        view: &SourceView<'_>,
        statements: &[Statement<'_>],
        scope_id: ScopeId,
        imports: &SemanticImportIndex<'_>,
    ) {
        for statement in statements {
            self.statement(view, statement, scope_id, imports);
        }
    }

    fn statement(
        &mut self,
        view: &SourceView<'_>,
        statement: &Statement<'_>,
        scope_id: ScopeId,
        imports: &SemanticImportIndex<'_>,
    ) {
        match statement {
            Statement::ExportNamedDeclaration(export) => {
                if let Some(declaration) = &export.declaration {
                    self.declaration(view, declaration, scope_id, imports);
                }
            }
            Statement::ExportDefaultDeclaration(export) => {
                self.export_default(view, &export.declaration, scope_id, imports);
            }
            Statement::VariableDeclaration(declaration) => {
                self.variable_declaration(view, declaration, scope_id, imports);
            }
            Statement::FunctionDeclaration(function) => {
                self.function_body(view, function, imports);
            }
            Statement::ExpressionStatement(statement) => {
                self.expression(view, &statement.expression, scope_id, imports);
            }
            Statement::ReturnStatement(statement) => {
                if let Some(argument) = &statement.argument {
                    self.expression(view, argument, scope_id, imports);
                }
            }
            Statement::BlockStatement(block) => {
                self.statements(
                    view,
                    &block.body,
                    block.scope_id.get().unwrap_or(scope_id),
                    imports,
                );
            }
            Statement::IfStatement(statement) => {
                self.expression(view, &statement.test, scope_id, imports);
                self.statement(view, &statement.consequent, scope_id, imports);
                if let Some(alternate) = &statement.alternate {
                    self.statement(view, alternate, scope_id, imports);
                }
            }
            _ => {}
        }
    }

    fn declaration(
        &mut self,
        view: &SourceView<'_>,
        declaration: &Declaration<'_>,
        scope_id: ScopeId,
        imports: &SemanticImportIndex<'_>,
    ) {
        match declaration {
            Declaration::VariableDeclaration(declaration) => {
                self.variable_declaration(view, declaration, scope_id, imports);
            }
            Declaration::FunctionDeclaration(function) => {
                self.function_body(view, function, imports);
            }
            _ => {}
        }
    }

    fn export_default(
        &mut self,
        view: &SourceView<'_>,
        declaration: &ExportDefaultDeclarationKind<'_>,
        scope_id: ScopeId,
        imports: &SemanticImportIndex<'_>,
    ) {
        match declaration {
            ExportDefaultDeclarationKind::FunctionDeclaration(function) => {
                self.function_body(view, function, imports)
            }
            ExportDefaultDeclarationKind::CallExpression(call) => {
                self.expression(view, &call.callee, scope_id, imports);
                self.arguments(view, &call.arguments, scope_id, imports);
            }
            ExportDefaultDeclarationKind::NewExpression(new_expression) => {
                self.expression(view, &new_expression.callee, scope_id, imports);
                self.arguments(view, &new_expression.arguments, scope_id, imports);
            }
            _ => {}
        }
    }

    fn variable_declaration(
        &mut self,
        view: &SourceView<'_>,
        declaration: &VariableDeclaration<'_>,
        scope_id: ScopeId,
        imports: &SemanticImportIndex<'_>,
    ) {
        for declarator in &declaration.declarations {
            let value_start = declarator
                .init
                .as_ref()
                .map_or(declarator.span.start, |init| init.span().start);
            for (record, symbol_id) in
                initializer_records_from_declarator(view, declarator, imports)
                    .into_iter()
                    .zip(binding_symbol_ids(&declarator.id))
            {
                self.by_scope
                    .entry(scope_id)
                    .or_default()
                    .push(ScopedInitializer {
                        symbol_id,
                        value_start,
                        record,
                    });
            }
            if let Some(init) = &declarator.init {
                self.expression(view, init, scope_id, imports);
            }
        }
    }

    fn function_body(
        &mut self,
        view: &SourceView<'_>,
        function: &Function<'_>,
        imports: &SemanticImportIndex<'_>,
    ) {
        if let Some(body) = &function.body {
            let scope_id = function
                .scope_id
                .get()
                .unwrap_or_else(|| self.scoping.root_scope_id());
            self.statements(view, &body.statements, scope_id, imports);
        }
    }

    fn arrow_body(
        &mut self,
        view: &SourceView<'_>,
        function: &ArrowFunctionExpression<'_>,
        imports: &SemanticImportIndex<'_>,
    ) {
        let scope_id = function
            .scope_id
            .get()
            .unwrap_or_else(|| self.scoping.root_scope_id());
        self.statements(view, &function.body.statements, scope_id, imports);
    }

    fn expression(
        &mut self,
        view: &SourceView<'_>,
        expression: &Expression<'_>,
        scope_id: ScopeId,
        imports: &SemanticImportIndex<'_>,
    ) {
        match expression {
            Expression::CallExpression(call) => {
                self.expression(view, &call.callee, scope_id, imports);
                self.arguments(view, &call.arguments, scope_id, imports);
            }
            Expression::NewExpression(new_expression) => {
                self.expression(view, &new_expression.callee, scope_id, imports);
                self.arguments(view, &new_expression.arguments, scope_id, imports);
            }
            Expression::ObjectExpression(object) => {
                for property in &object.properties {
                    match property {
                        ObjectPropertyKind::ObjectProperty(property) => {
                            self.expression(view, &property.value, scope_id, imports)
                        }
                        ObjectPropertyKind::SpreadProperty(spread) => {
                            self.expression(view, &spread.argument, scope_id, imports)
                        }
                    }
                }
            }
            Expression::ArrayExpression(array) => {
                for element in &array.elements {
                    self.array_element(view, element, scope_id, imports);
                }
            }
            Expression::ArrowFunctionExpression(function) => {
                self.arrow_body(view, function, imports)
            }
            Expression::FunctionExpression(function) => self.function_body(view, function, imports),
            Expression::AwaitExpression(await_expression) => {
                self.expression(view, &await_expression.argument, scope_id, imports)
            }
            Expression::StaticMemberExpression(member) => {
                self.expression(view, &member.object, scope_id, imports)
            }
            Expression::ParenthesizedExpression(parenthesized) => {
                self.expression(view, &parenthesized.expression, scope_id, imports)
            }
            _ => {}
        }
    }

    fn arguments(
        &mut self,
        view: &SourceView<'_>,
        arguments: &[Argument<'_>],
        scope_id: ScopeId,
        imports: &SemanticImportIndex<'_>,
    ) {
        for argument in arguments {
            match argument {
                Argument::ArrowFunctionExpression(function) => {
                    self.arrow_body(view, function, imports)
                }
                Argument::FunctionExpression(function) => {
                    self.function_body(view, function, imports)
                }
                _ => {
                    if let Some(expression) = argument.as_expression() {
                        self.expression(view, expression, scope_id, imports);
                    }
                }
            }
        }
    }

    fn array_element(
        &mut self,
        view: &SourceView<'_>,
        element: &ArrayExpressionElement<'_>,
        scope_id: ScopeId,
        imports: &SemanticImportIndex<'_>,
    ) {
        match element {
            ArrayExpressionElement::ArrowFunctionExpression(function) => {
                self.arrow_body(view, function, imports)
            }
            ArrayExpressionElement::FunctionExpression(function) => {
                self.function_body(view, function, imports)
            }
            ArrayExpressionElement::SpreadElement(spread) => {
                self.expression(view, &spread.argument, scope_id, imports)
            }
            _ => {
                if let Some(expression) = element.as_expression() {
                    self.expression(view, expression, scope_id, imports);
                }
            }
        }
    }
}
