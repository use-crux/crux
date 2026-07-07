use std::collections::HashMap;

use serde_json::{Value, json};

use crate::{
    protocol::{LiteralValue, StaticInitializerRecord, StaticSyntaxValue},
    record_values::{direct_string_property, property_value, resolve_static_value},
};

const SAFETY_BOUNDARY_IDS: &[&str] = &[
    "user.input",
    "model.input",
    "model.output.text",
    "model.output.object",
    "model.output",
    "tool.call",
    "tool.result",
    "approval.request",
    "retrieval.result",
    "memory.write",
    "validation.feedback",
];

const HELPER_BOUNDARY_IDS: &[(&str, &str)] = &[
    ("boundary.input.user", "user.input"),
    ("boundary.input.text", "user.input"),
    ("boundary.input.model", "model.input"),
    ("boundary.output.text", "model.output.text"),
    ("boundary.output.object", "model.output.object"),
    ("boundary.output.both", "model.output"),
    ("boundary.output.path", "model.output.object"),
    ("boundary.tool.call", "tool.call"),
    ("boundary.tool.result", "tool.result"),
    ("boundary.approval.request", "approval.request"),
    ("boundary.retrieval.result", "retrieval.result"),
    ("boundary.memory.write", "memory.write"),
    ("boundary.validation.feedback", "validation.feedback"),
];

pub(crate) fn policy_id_for(config: &StaticSyntaxValue, fallback: &str) -> String {
    direct_string_property(config, "id")
        .or_else(|| direct_string_property(config, "name"))
        .unwrap_or_else(|| fallback.to_string())
}

pub(crate) fn strategy_facts(
    config: &StaticSyntaxValue,
    initializers: &HashMap<&str, &StaticInitializerRecord>,
) -> Option<Value> {
    let value = property_value(config, "run")?;
    let resolved = resolve_static_value(value, initializers, &mut Default::default());
    let StaticSyntaxValue::Call { callee, .. } = resolved else {
        return None;
    };
    Some(json!({ "kind": callee.name }))
}

pub(crate) fn safety_boundaries(config: &StaticSyntaxValue) -> Vec<String> {
    property_value(config, "on")
        .map(boundary_ids_from_value)
        .unwrap_or_default()
}

fn boundary_ids_from_value(value: &StaticSyntaxValue) -> Vec<String> {
    match value {
        StaticSyntaxValue::Array { elements } => {
            let mut ids = Vec::new();
            for element in elements {
                for id in boundary_ids_from_value(element) {
                    if !ids.contains(&id) {
                        ids.push(id);
                    }
                }
            }
            ids
        }
        _ => boundary_id_from_value(value).into_iter().collect(),
    }
}

fn boundary_id_from_value(value: &StaticSyntaxValue) -> Option<String> {
    match value {
        StaticSyntaxValue::Literal {
            value: LiteralValue::String(value),
        } if SAFETY_BOUNDARY_IDS.contains(&value.as_str()) => Some(value.clone()),
        StaticSyntaxValue::Call { .. } => {
            helper_boundary_id(&call_path(value)).or_else(|| helper_boundary_id_from_snippet(value))
        }
        StaticSyntaxValue::PropertyAccess { path, .. } => helper_boundary_id(path),
        _ => None,
    }
}

fn helper_boundary_id(path: &[String]) -> Option<String> {
    helper_boundary_id_for_path(&path.join("."))
}

fn helper_boundary_id_for_path(path: &str) -> Option<String> {
    HELPER_BOUNDARY_IDS
        .iter()
        .find_map(|(helper, id)| (*helper == path).then(|| (*id).to_string()))
}

fn helper_boundary_id_from_snippet(value: &StaticSyntaxValue) -> Option<String> {
    let StaticSyntaxValue::Call {
        snippet: Some(snippet),
        ..
    } = value
    else {
        return None;
    };
    let source = snippet.source.trim_start();
    HELPER_BOUNDARY_IDS.iter().find_map(|(helper, id)| {
        let rest = source.strip_prefix(helper)?;
        matches!(rest.chars().next(), None | Some('<' | '(' | '[' | '.')).then(|| (*id).to_string())
    })
}

fn call_path(value: &StaticSyntaxValue) -> Vec<String> {
    let StaticSyntaxValue::Call {
        callee, receiver, ..
    } = value
    else {
        return Vec::new();
    };
    let mut path = value_path(receiver.as_deref());
    path.push(callee.name.clone());
    path
}

fn value_path(value: Option<&StaticSyntaxValue>) -> Vec<String> {
    match value {
        Some(StaticSyntaxValue::Identifier { name }) => vec![name.clone()],
        Some(StaticSyntaxValue::PropertyAccess { path, .. }) => path.clone(),
        Some(value @ StaticSyntaxValue::Call { .. }) => call_path(value),
        _ => Vec::new(),
    }
}
