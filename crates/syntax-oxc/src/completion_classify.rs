//! Structural completion-site recognition over one tolerant Oxc parse.

use std::collections::BTreeSet;

use crux_indexer_primitives::{
    completion::{CompletionSite, CompletionSlot},
    producer_identity::is_first_party_producer,
};
use oxc_ast::{AstKind, ast::*};
use oxc_semantic::{ScopeId, Semantic};
use oxc_span::{GetSpan, Span};

use crate::{
    completion_ast::{member_expressions, property_name},
    completion_existing::{call_owner_name, existing_values},
    syntax::semantic_imports::SemanticImportIndex,
};

/// Syntax surrounding the active replacement range.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum ReplacementSyntax {
    Identifier,
    StringLiteral,
}

/// One compiler-proven manifest site at the request cursor.
pub(crate) struct ClassifiedSlot<'site> {
    pub(crate) site: &'site CompletionSite,
    pub(crate) scope_id: ScopeId,
    pub(crate) replacement: Span,
    pub(crate) replacement_syntax: ReplacementSyntax,
    pub(crate) prefix: String,
    pub(crate) owner_name: Option<String>,
    pub(crate) existing: BTreeSet<String>,
}

/// Finds the first exact manifest path whose terminal expression owns the cursor.
pub(crate) fn classify_slot<'site>(
    semantic: &Semantic<'_>,
    imports: &SemanticImportIndex<'_>,
    cursor: usize,
    sites: &'site [CompletionSite],
) -> Option<ClassifiedSlot<'site>> {
    let cursor = u32::try_from(cursor).ok()?;
    for node in semantic.nodes().iter() {
        let AstKind::CallExpression(call) = node.kind() else {
            continue;
        };
        let Some((call_name, module_specifier)) = imported_call_identity(call, imports) else {
            continue;
        };
        if !is_first_party_producer("call", &call_name, Some(module_specifier)) {
            continue;
        }
        for site in sites
            .iter()
            .filter(|site| site.call_names.iter().any(|name| name == &call_name))
        {
            for expression in expressions_at_site(call, &site.property_path) {
                let Some((replacement, syntax, prefix)) =
                    replacement_at_cursor(expression, cursor, semantic.source_text(), site.slot)
                else {
                    continue;
                };
                let scope_id = semantic
                    .nodes()
                    .iter()
                    .filter(|candidate| candidate.kind().span() == expression.span())
                    .map(|candidate| candidate.scope_id())
                    .next()
                    .unwrap_or_else(|| node.scope_id());
                return Some(ClassifiedSlot {
                    site,
                    scope_id,
                    replacement,
                    replacement_syntax: syntax,
                    prefix,
                    owner_name: call_owner_name(call, semantic),
                    existing: existing_values(call, site.slot),
                });
            }
        }
    }
    None
}

fn expressions_at_site<'ast>(
    call: &'ast CallExpression<'ast>,
    path: &[String],
) -> Vec<&'ast Expression<'ast>> {
    let Some((first, rest)) = path.split_first() else {
        return Vec::new();
    };
    if first == "$args" {
        let Some((selector, tail)) = rest.split_first() else {
            return Vec::new();
        };
        return selected_arguments(call, selector)
            .into_iter()
            .flat_map(|expression| navigate(expression, tail))
            .collect();
    }
    let Some(root) = call.arguments.first().and_then(Argument::as_expression) else {
        return Vec::new();
    };
    navigate(root, path)
}

fn selected_arguments<'ast>(
    call: &'ast CallExpression<'ast>,
    selector: &str,
) -> Vec<&'ast Expression<'ast>> {
    if selector == "*" {
        return call
            .arguments
            .iter()
            .filter_map(Argument::as_expression)
            .collect();
    }
    selector
        .parse::<usize>()
        .ok()
        .and_then(|index| call.arguments.get(index))
        .and_then(Argument::as_expression)
        .into_iter()
        .collect()
}

fn navigate<'ast>(
    expression: &'ast Expression<'ast>,
    path: &[String],
) -> Vec<&'ast Expression<'ast>> {
    let Some((segment, tail)) = path.split_first() else {
        return vec![expression];
    };
    if segment == "*" {
        return member_expressions(expression)
            .into_iter()
            .flat_map(|member| navigate(member, tail))
            .collect();
    }
    let Expression::ObjectExpression(object) = expression else {
        return Vec::new();
    };
    object
        .properties
        .iter()
        .filter_map(|property| match property {
            ObjectPropertyKind::ObjectProperty(property)
                if property_name(&property.key).as_deref() == Some(segment.as_str()) =>
            {
                Some(&property.value)
            }
            _ => None,
        })
        .flat_map(|value| navigate(value, tail))
        .collect()
}

fn replacement_at_cursor(
    expression: &Expression<'_>,
    cursor: u32,
    source: &str,
    slot: CompletionSlot,
) -> Option<(Span, ReplacementSyntax, String)> {
    match expression {
        Expression::Identifier(identifier)
            if cursor >= identifier.span.start && cursor <= identifier.span.end =>
        {
            let prefix = source
                .get(identifier.span.start as usize..cursor as usize)
                .unwrap_or_default()
                .to_string();
            Some((
                Span::new(identifier.span.start, cursor),
                ReplacementSyntax::Identifier,
                prefix,
            ))
        }
        Expression::StringLiteral(literal)
            if slot == CompletionSlot::StaticId
                && cursor > literal.span.start
                && cursor < literal.span.end =>
        {
            let start = literal.span.start + 1;
            let prefix = source
                .get(start as usize..cursor as usize)
                .unwrap_or_default()
                .to_string();
            Some((
                Span::new(start, cursor),
                ReplacementSyntax::StringLiteral,
                prefix,
            ))
        }
        _ => None,
    }
}

fn imported_call_identity<'a>(
    call: &CallExpression<'_>,
    imports: &'a SemanticImportIndex<'a>,
) -> Option<(String, &'a str)> {
    let import = imports.record_for_callee(&call.callee)?;
    if import.import_kind.as_deref() == Some("type") {
        return None;
    }
    let imported_name = match &call.callee {
        Expression::Identifier(_) => import.imported_name.clone(),
        Expression::StaticMemberExpression(member) => member.property.name.as_str().to_string(),
        _ => return None,
    };
    Some((imported_name, import.module_specifier.as_str()))
}
