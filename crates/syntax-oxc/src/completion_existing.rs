//! Existing-contributor and containing-definition exclusion evidence.

use std::collections::BTreeSet;

use crux_indexer_primitives::completion::CompletionSlot;
use oxc_ast::{AstKind, ast::*};
use oxc_semantic::Semantic;
use oxc_span::GetSpan;

use crate::completion_ast::{member_expressions, property_expression, property_name};

pub(crate) fn existing_values(call: &CallExpression<'_>, slot: CompletionSlot) -> BTreeSet<String> {
    let Some(root) = call.arguments.first().and_then(Argument::as_expression) else {
        return BTreeSet::new();
    };
    match slot {
        CompletionSlot::IdentifierArrayElement => property_expression(root, "use")
            .map(identifier_values)
            .unwrap_or_default(),
        CompletionSlot::ToolMapMember => property_expression(root, "tools")
            .map(tool_map_values)
            .unwrap_or_default(),
        CompletionSlot::StaticId => property_expression(root, "handoffs")
            .map(static_id_values)
            .unwrap_or_default(),
        CompletionSlot::ScalarIdentifier | CompletionSlot::RoutingTarget => BTreeSet::new(),
    }
}

pub(crate) fn call_owner_name(
    call: &CallExpression<'_>,
    semantic: &Semantic<'_>,
) -> Option<String> {
    let explicit = call
        .arguments
        .iter()
        .filter_map(Argument::as_expression)
        .filter_map(|argument| property_expression(argument, "id"))
        .find_map(|id| match id {
            Expression::StringLiteral(literal) => Some(literal.value.as_str().to_string()),
            _ => None,
        });
    explicit.or_else(|| {
        semantic.nodes().iter().find_map(|node| {
            let AstKind::VariableDeclarator(declarator) = node.kind() else {
                return None;
            };
            if declarator.init.as_ref().map(GetSpan::span) != Some(call.span) {
                return None;
            }
            match &declarator.id {
                BindingPattern::BindingIdentifier(identifier) => {
                    Some(identifier.name.as_str().to_string())
                }
                _ => None,
            }
        })
    })
}

fn identifier_values(expression: &Expression<'_>) -> BTreeSet<String> {
    member_expressions(expression)
        .into_iter()
        .filter_map(|member| match member {
            Expression::Identifier(identifier) => Some(identifier.name.as_str().to_string()),
            _ => None,
        })
        .collect()
}

fn tool_map_values(expression: &Expression<'_>) -> BTreeSet<String> {
    let Expression::ObjectExpression(object) = expression else {
        return BTreeSet::new();
    };
    object
        .properties
        .iter()
        .flat_map(|property| match property {
            ObjectPropertyKind::ObjectProperty(property) => [
                property_name(&property.key),
                match &property.value {
                    Expression::Identifier(identifier) => {
                        Some(identifier.name.as_str().to_string())
                    }
                    _ => None,
                },
            ],
            ObjectPropertyKind::SpreadProperty(_) => [None, None],
        })
        .flatten()
        .collect()
}

fn static_id_values(expression: &Expression<'_>) -> BTreeSet<String> {
    member_expressions(expression)
        .into_iter()
        .filter_map(|member| match member {
            Expression::StringLiteral(literal) => Some(literal.value.as_str().to_string()),
            Expression::ObjectExpression(_) => {
                property_expression(member, "id").and_then(|id| match id {
                    Expression::StringLiteral(literal) => Some(literal.value.as_str().to_string()),
                    _ => None,
                })
            }
            _ => None,
        })
        .collect()
}
