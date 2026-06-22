use std::{
    collections::{HashMap, HashSet},
    path::Path,
};

use oxc_ast::ast::*;
use oxc_span::Span;

use crate::{
    match_interests::{CalleeMatcher, EvidenceSlice},
    protocol::{StaticImportRecord, StaticInitializerRecord, StaticSourceMatch, StaticSyntaxValue},
    source::{SourceNeedleIndex, SourceView},
    values::{call_args, callee_record_from_expression, expression_name, object_value},
};

#[derive(Clone, Copy)]
pub(crate) struct MatchContext<'a, 'b> {
    pub(crate) root: &'a str,
    pub(crate) file: &'a str,
    pub(crate) view: &'a SourceView<'a>,
    pub(crate) imports: &'b HashMap<String, StaticImportRecord>,
    pub(crate) call_matcher: &'b CalleeMatcher,
    pub(crate) constructor_matcher: &'b CalleeMatcher,
    pub(crate) needle_index: &'b SourceNeedleIndex,
}

pub(crate) fn match_from_declarator(
    context: MatchContext<'_, '_>,
    declarator: &VariableDeclarator<'_>,
    exported: bool,
    scoped_initializers: &[StaticInitializerRecord],
) -> Option<StaticSourceMatch> {
    let init = declarator.init.as_ref()?;
    let variable_name = declarator.id_name()?;
    match init {
        Expression::ObjectExpression(object) => Some(StaticSourceMatch::Object {
            variable_name: variable_name.clone(),
            local_name: fallback_local_name(context.root, context.file, &variable_name),
            exported,
            object: object_value(context.view, object, context.imports),
            source: context.view.location_for_span(&**object),
            snippet: Some(context.view.snippet_for_span(&**object)),
            local_initializers: scoped_initializers.to_vec(),
        }),
        Expression::CallExpression(call) => {
            let callee = callee_record_from_expression(&call.callee, context.imports);
            if !context.call_matcher.allows(&callee) {
                return None;
            }
            Some(call_match(
                context,
                variable_name,
                call,
                exported,
                scoped_initializers,
            ))
        }
        Expression::NewExpression(new_expression) => new_match(
            context,
            variable_name,
            new_expression,
            exported,
            scoped_initializers,
        ),
        _ => None,
    }
}

pub(crate) fn call_match(
    context: MatchContext<'_, '_>,
    variable_name: String,
    call: &CallExpression<'_>,
    exported: bool,
    scoped_initializers: &[StaticInitializerRecord],
) -> StaticSourceMatch {
    let callee = callee_record_from_expression(&call.callee, context.imports);
    let evidence = context.call_matcher.evidence_for(&callee);
    StaticSourceMatch::Call {
        local_name: fallback_local_name(context.root, context.file, &variable_name),
        variable_name,
        exported,
        callee,
        args: call_args(context.view, &call.arguments, context.imports),
        object_arg: object_arg(
            context.view,
            &call.arguments,
            context.imports,
            evidence.as_ref(),
        ),
        source: context.view.location_for_span(call),
        snippet: Some(context.view.snippet_for_span(call)),
        local_initializers: scoped_initializers.to_vec(),
    }
}

pub(crate) fn new_match(
    context: MatchContext<'_, '_>,
    variable_name: String,
    new_expression: &NewExpression<'_>,
    exported: bool,
    scoped_initializers: &[StaticInitializerRecord],
) -> Option<StaticSourceMatch> {
    expression_name(&new_expression.callee)?;
    let callee = callee_record_from_expression(&new_expression.callee, context.imports);
    if !context.constructor_matcher.allows(&callee) {
        return None;
    }
    let evidence = context.constructor_matcher.evidence_for(&callee);
    Some(StaticSourceMatch::New {
        local_name: fallback_local_name(context.root, context.file, &variable_name),
        variable_name,
        exported,
        callee,
        args: call_args(context.view, &new_expression.arguments, context.imports),
        object_arg: object_arg(
            context.view,
            &new_expression.arguments,
            context.imports,
            evidence.as_ref(),
        ),
        source: context.view.location_for_span(new_expression),
        snippet: Some(context.view.snippet_for_span(new_expression)),
        local_initializers: scoped_initializers.to_vec(),
    })
}

fn object_arg(
    view: &SourceView<'_>,
    args: &[Argument<'_>],
    imports: &HashMap<String, StaticImportRecord>,
    evidence: Option<&EvidenceSlice>,
) -> Option<StaticSyntaxValue> {
    let object = match evidence.and_then(|slice| slice.config_arg) {
        Some(index) => args.get(index).and_then(argument_object),
        None => args.iter().find_map(argument_object),
    }?;
    sliced_object_value(object_value(view, object, imports), evidence)
}

fn argument_object<'a>(arg: &'a Argument<'a>) -> Option<&'a ObjectExpression<'a>> {
    match arg {
        Argument::ObjectExpression(object) => Some(object),
        _ => None,
    }
}

fn sliced_object_value(
    value: StaticSyntaxValue,
    evidence: Option<&EvidenceSlice>,
) -> Option<StaticSyntaxValue> {
    let Some(evidence) = evidence else {
        return Some(value);
    };
    if evidence.properties.is_empty() {
        return None;
    }
    match value {
        StaticSyntaxValue::Object {
            properties,
            source,
            snippet,
        } => Some(StaticSyntaxValue::Object {
            properties: properties
                .into_iter()
                .filter(|property| {
                    property.spread != Some(true) && evidence.properties.contains(&property.name)
                })
                .collect(),
            source,
            snippet,
        }),
        other => Some(other),
    }
}

pub(crate) fn traversal_needles(
    call_names: &HashSet<String>,
    constructor_names: &HashSet<String>,
    imports: &HashMap<String, StaticImportRecord>,
) -> Vec<String> {
    if call_names.is_empty() && constructor_names.is_empty() {
        return Vec::new();
    }
    let mut needles = call_names
        .iter()
        .chain(constructor_names.iter())
        .cloned()
        .collect::<Vec<_>>();
    needles.extend(
        imports
            .values()
            .filter(|import| {
                call_names.contains(&import.imported_name)
                    || constructor_names.contains(&import.imported_name)
            })
            .map(|import| import.local_name.clone()),
    );
    needles.sort();
    needles.dedup();
    needles
}

pub(crate) fn should_skip_subtree(context: MatchContext<'_, '_>, span: Span) -> bool {
    !context.needle_index.is_empty() && !context.needle_index.contains_span(span)
}

trait DeclaratorName {
    fn id_name(&self) -> Option<String>;
}

impl DeclaratorName for VariableDeclarator<'_> {
    fn id_name(&self) -> Option<String> {
        match &self.id {
            BindingPattern::BindingIdentifier(identifier) => {
                Some(identifier.name.as_str().to_string())
            }
            _ => None,
        }
    }
}

fn fallback_local_name(root: &str, file: &str, variable_name: &str) -> String {
    let relative = Path::new(file)
        .strip_prefix(root)
        .unwrap_or_else(|_| Path::new(file))
        .to_string_lossy()
        .replace('\\', "/");
    format!("{relative}:{variable_name}")
}
