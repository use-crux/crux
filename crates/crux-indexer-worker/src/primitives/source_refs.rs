use std::collections::HashSet;

use serde_json::Value;

use crate::{
    primitives::definition::{source_ref, source_ref_with_metadata},
    primitives::record_values::{property_value, resolve_static_value},
    primitives::routing_model::{ResolvedSource, RoutingContext},
    protocol::{StaticFunctionCallValue, StaticSyntaxValue},
};

pub(crate) fn schema_source_ref(
    definition_id: &str,
    property: &str,
    resolved: &ResolvedSource<'_>,
    metadata: Value,
) -> Value {
    source_ref_with_metadata(
        definition_id,
        "schema",
        property,
        &resolved.symbol,
        &resolved.source,
        resolved.function_name.as_deref(),
        resolved.snippet.as_ref(),
        Some(metadata),
    )
}

pub(crate) fn property_source_ref(
    context: &RoutingContext<'_>,
    definition_id: &str,
    object: &StaticSyntaxValue,
    property: &str,
    role: &str,
    metadata: Option<Value>,
    require_function: bool,
) -> Option<Option<Value>> {
    let Some(resolved) = context.resolve_record_source(property_value(object, property))? else {
        return Some(None);
    };
    if require_function && !matches!(resolved.value, StaticSyntaxValue::Function { .. }) {
        return Some(None);
    }
    Some(Some(source_ref_with_metadata(
        definition_id,
        role,
        property,
        &resolved.symbol,
        &resolved.source,
        resolved.function_name.as_deref(),
        resolved.snippet.as_ref(),
        metadata,
    )))
}

pub(crate) fn template_interpolation_source_refs(
    context: &RoutingContext<'_>,
    definition_id: &str,
    object: &StaticSyntaxValue,
    property: &str,
    role: &str,
) -> Option<Vec<Value>> {
    let value = property_value(object, property);
    let resolved = context.resolve_record_source(value)?;
    let root = resolved
        .as_ref()
        .map(|source| source.value)
        .unwrap_or_else(|| {
            value.map_or(object, |value| {
                resolve_static_value(value, &context.initializers, &mut Default::default())
            })
        });
    let StaticSyntaxValue::Template { expressions, .. } = root else {
        return Some(Vec::new());
    };
    let mut seen = HashSet::new();
    let mut refs = Vec::new();
    for expression in expressions {
        let Some(resolved) = context.resolve_record_source(Some(expression))? else {
            continue;
        };
        if !seen.insert(resolved.symbol.clone()) {
            continue;
        }
        refs.push(source_ref_with_metadata(
            definition_id,
            role,
            property,
            &resolved.symbol,
            &resolved.source,
            resolved.function_name.as_deref(),
            resolved.snippet.as_ref(),
            Some(template_metadata(resolved.value)),
        ));
    }
    Some(refs)
}

pub(crate) fn helper_refs_for_property(
    context: &RoutingContext<'_>,
    definition_id: &str,
    object: &StaticSyntaxValue,
    property: &str,
    max_depth: usize,
) -> Option<Vec<Value>> {
    let value = property_value(object, property);
    let resolved = context.resolve_record_source(value)?;
    let root = resolved
        .as_ref()
        .map(|source| source.value)
        .unwrap_or_else(|| {
            value.map_or(object, |value| {
                resolve_static_value(value, &context.initializers, &mut Default::default())
            })
        });
    collect_helper_refs(
        context,
        definition_id,
        &helper_calls(root),
        &mut HashSet::new(),
        max_depth,
    )
}

fn collect_helper_refs(
    context: &RoutingContext<'_>,
    definition_id: &str,
    calls: &[StaticFunctionCallValue],
    seen: &mut HashSet<String>,
    depth: usize,
) -> Option<Vec<Value>> {
    if depth == 0 {
        return Some(Vec::new());
    }
    let mut refs = Vec::new();
    for call in calls {
        let Some(symbol) = helper_call_symbol(call) else {
            continue;
        };
        if !seen.insert(symbol.to_string()) {
            continue;
        }
        let identifier = StaticSyntaxValue::Identifier {
            name: symbol.to_string(),
        };
        let Some(resolved) = context.resolve_record_source(Some(&identifier))? else {
            continue;
        };
        if !matches!(resolved.value, StaticSyntaxValue::Function { .. }) {
            continue;
        }
        refs.push(source_ref(
            definition_id,
            "helper",
            symbol,
            &resolved.symbol,
            &resolved.source,
            resolved.function_name.as_deref(),
            resolved.snippet.as_ref(),
        ));
        refs.extend(collect_helper_refs(
            context,
            definition_id,
            &helper_calls(resolved.value),
            seen,
            depth - 1,
        )?);
    }
    Some(refs)
}

fn helper_calls(value: &StaticSyntaxValue) -> Vec<StaticFunctionCallValue> {
    match value {
        StaticSyntaxValue::Function { calls, .. } => calls.clone(),
        StaticSyntaxValue::Call {
            callee,
            receiver,
            args,
            source,
            snippet,
        } => vec![StaticFunctionCallValue {
            callee: callee.clone(),
            receiver: receiver.clone(),
            args: args.clone(),
            source: source.clone(),
            snippet: snippet.clone(),
        }],
        _ => Vec::new(),
    }
}

fn helper_call_symbol(call: &StaticFunctionCallValue) -> Option<&str> {
    if call.receiver.is_some() {
        return None;
    }
    call.callee
        .local_name
        .as_deref()
        .or(Some(call.callee.name.as_str()))
}

fn template_metadata(value: &StaticSyntaxValue) -> Value {
    let mut metadata = serde_json::Map::new();
    metadata.insert("injected".to_string(), Value::Bool(true));
    metadata.insert("fragment".to_string(), Value::Bool(is_fragment_like(value)));
    Value::Object(metadata)
}

fn is_fragment_like(value: &StaticSyntaxValue) -> bool {
    matches!(
        value,
        StaticSyntaxValue::Literal {
            value: crate::protocol::LiteralValue::String(_)
        } | StaticSyntaxValue::Template { .. }
    )
}
