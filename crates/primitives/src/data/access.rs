use std::collections::HashSet;

pub(crate) use crate::data::output::{data_access_relation_refs, primitive_data_intelligence};

use crate::{
    context::PrimitiveContext,
    protocol::{LiteralValue, SourceLocation, StaticFunctionCallValue, StaticSyntaxValue},
    record_values::{property_value, resolve_static_value},
};

#[derive(Clone)]
pub(crate) struct DataAccessRef {
    pub(crate) kind: &'static str,
    pub(crate) target_variable: String,
    pub(crate) operation: &'static str,
    pub(crate) target_kind: Option<&'static str>,
    pub(crate) key: Option<String>,
    pub(crate) source: SourceLocation,
}

pub(crate) fn data_access_refs_for_config_object(
    context: &PrimitiveContext<'_>,
    object: &StaticSyntaxValue,
) -> Vec<DataAccessRef> {
    data_access_refs_from_value(context, Some(object), 1)
}

pub(crate) fn data_access_refs_for_value(
    context: &PrimitiveContext<'_>,
    value: &StaticSyntaxValue,
    max_helper_depth: usize,
) -> Vec<DataAccessRef> {
    data_access_refs_from_value(context, Some(value), max_helper_depth)
}

pub(crate) fn data_access_refs_for_properties(
    context: &PrimitiveContext<'_>,
    object: &StaticSyntaxValue,
    properties: &[&str],
) -> Vec<DataAccessRef> {
    properties
        .iter()
        .flat_map(|property| {
            data_access_refs_from_value(context, property_value(object, property), 1)
        })
        .collect()
}

pub(crate) fn unique_data_accesses(accesses: Vec<DataAccessRef>) -> Vec<DataAccessRef> {
    let mut seen = HashSet::new();
    accesses
        .into_iter()
        .filter(|access| {
            seen.insert(format!(
                "{}:{}:{}:{}",
                access.kind,
                access.target_variable,
                access.operation,
                access.key.as_deref().unwrap_or_default()
            ))
        })
        .collect()
}

fn data_access_refs_from_value(
    context: &PrimitiveContext<'_>,
    value: Option<&StaticSyntaxValue>,
    max_helper_depth: usize,
) -> Vec<DataAccessRef> {
    let Some(value) = value else {
        return Vec::new();
    };
    let resolved = resolve_static_value(value, &context.initializers, &mut HashSet::new());
    let calls = calls_for_value(resolved);
    let mut accesses = data_access_refs_from_calls(&calls);
    accesses.extend(helper_data_access_refs_from_calls(
        context,
        &calls,
        &mut HashSet::new(),
        max_helper_depth,
    ));
    accesses
}

fn calls_for_value(value: &StaticSyntaxValue) -> Vec<StaticFunctionCallValue> {
    match value {
        StaticSyntaxValue::Function { calls, .. } => calls.clone(),
        StaticSyntaxValue::Call {
            callee,
            receiver,
            args,
            source,
            snippet,
        } => {
            let mut calls = vec![StaticFunctionCallValue {
                callee: callee.clone(),
                receiver: receiver.clone(),
                args: args.clone(),
                source: source.clone(),
                snippet: snippet.clone(),
            }];
            calls.extend(args.iter().flat_map(calls_for_value));
            calls
        }
        StaticSyntaxValue::Array { elements } => {
            elements.iter().flat_map(calls_for_value).collect()
        }
        StaticSyntaxValue::Object { properties, .. } => properties
            .iter()
            .filter(|property| property.spread != Some(true))
            .flat_map(|property| calls_for_value(&property.value))
            .collect(),
        StaticSyntaxValue::Template { expressions, .. } => {
            expressions.iter().flat_map(calls_for_value).collect()
        }
        StaticSyntaxValue::TaggedTemplate { expressions, .. } => expressions
            .iter()
            .flat_map(|expression| calls_for_value(&expression.value))
            .collect(),
        _ => Vec::new(),
    }
}

fn data_access_refs_from_calls(calls: &[StaticFunctionCallValue]) -> Vec<DataAccessRef> {
    calls
        .iter()
        .filter_map(|call| {
            let kind = data_access_kind(&call.callee.name)?;
            let target_variable = receiver_identifier(call.receiver.as_deref())?;
            Some(DataAccessRef {
                kind,
                target_variable: target_variable.to_string(),
                operation: data_access_operation(&call.callee.name, kind),
                target_kind: data_access_target_kind(target_variable),
                key: data_access_key(call.args.first()),
                source: call.source.clone(),
            })
        })
        .collect()
}

fn helper_data_access_refs_from_calls(
    context: &PrimitiveContext<'_>,
    calls: &[StaticFunctionCallValue],
    seen: &mut HashSet<String>,
    depth: usize,
) -> Vec<DataAccessRef> {
    if depth == 0 {
        return Vec::new();
    }
    calls
        .iter()
        .flat_map(|call| {
            if call.receiver.is_some() {
                return Vec::new();
            }
            let symbol = call
                .callee
                .local_name
                .as_deref()
                .unwrap_or(&call.callee.name);
            if !seen.insert(symbol.to_string()) {
                return Vec::new();
            }
            let Some(initializer) = context.initializers.get(symbol) else {
                return Vec::new();
            };
            let resolved = resolve_static_value(
                &initializer.value,
                &context.initializers,
                &mut HashSet::new(),
            );
            let StaticSyntaxValue::Function { calls, .. } = resolved else {
                return Vec::new();
            };
            let mut accesses = data_access_refs_from_calls(calls);
            accesses.extend(helper_data_access_refs_from_calls(
                context,
                calls,
                seen,
                depth - 1,
            ));
            accesses
        })
        .collect()
}

fn receiver_identifier(value: Option<&StaticSyntaxValue>) -> Option<&str> {
    match value {
        Some(StaticSyntaxValue::Identifier { name }) => Some(name.as_str()),
        _ => None,
    }
}

fn data_access_key(value: Option<&StaticSyntaxValue>) -> Option<String> {
    match value {
        Some(StaticSyntaxValue::Literal {
            value: LiteralValue::String(value),
        }) => Some(value.clone()),
        Some(StaticSyntaxValue::Literal {
            value: LiteralValue::Number(value),
        }) => Some(value.to_string()),
        _ => None,
    }
}

fn data_access_kind(method: &str) -> Option<&'static str> {
    match method {
        "get" | "read" | "query" | "find" | "search" | "list" | "readFile" | "load" | "grep"
        | "artifacts" | "stat" | "exists" | "watch" | "history" | "diff" => Some("read"),
        "set" | "write" | "update" | "append" | "delete" | "put" | "writeFile" | "edit"
        | "deleteFile" | "save" | "rename" | "move" | "copy" | "undo" | "finalize"
        | "transaction" => Some("write"),
        _ => None,
    }
}

fn data_access_operation(method: &str, kind: &str) -> &'static str {
    match method {
        "grep" => "grep",
        "artifacts" => "artifacts",
        "stat" => "stat",
        "exists" => "exists",
        "watch" => "watch",
        "rename" => "rename",
        "move" => "move",
        "copy" => "copy",
        "history" => "history",
        "diff" => "diff",
        "undo" => "undo",
        "finalize" => "finalize",
        "transaction" => "transaction",
        "query" | "find" | "search" | "list" => "query",
        "append" | "put" | "save" => "append",
        "update" | "edit" => "update",
        "delete" | "deleteFile" => "delete",
        _ if kind == "read" => "read",
        _ => "write",
    }
}

fn data_access_target_kind(target_variable: &str) -> Option<&'static str> {
    let normalized = target_variable.to_lowercase();
    if normalized.contains("blackboard") || normalized.contains("board") {
        return Some("blackboard");
    }
    if normalized.contains("workspace") || normalized.contains("file") || normalized.contains("fs")
    {
        return Some("workspace");
    }
    if normalized.contains("record") {
        return Some("storage.recordStore");
    }
    if normalized.contains("vector") {
        return Some("storage.vectorStore");
    }
    if normalized.contains("asset") {
        return Some("storage.assetStore");
    }
    if normalized.contains("storage") {
        return Some("storage.bundle");
    }
    if normalized.contains("store") {
        return Some("store");
    }
    if normalized.contains("block") {
        return Some("block");
    }
    if normalized.contains("memory") || normalized.contains("mem") || normalized.contains("state") {
        return Some("memory");
    }
    None
}
