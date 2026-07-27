use std::collections::{HashMap, HashSet};

use serde_json::{json, Value};

use crate::{
    protocol::{LiteralValue, StaticCalleeRecord, StaticInitializerRecord, StaticSyntaxValue},
    record_values::{direct_string_property, json_value, property_value, resolve_static_value},
    safety::classifier::media_classifier_config_value,
};

const SAFETY_API_MODULES: &[&str] = &["@use-crux/core", "@use-crux/core/safety"];
const GUARDRAIL_STRATEGY_KINDS: &[&str] = &[
    "classifier",
    "injection",
    "media",
    "mediaClassifier",
    "pii",
    "secrets",
];

const SAFETY_BOUNDARY_IDS: &[&str] = &[
    "model.input.text",
    "model.input.media",
    "model.input.tools",
    "model.instructions",
    "model.output.text",
    "model.output.media",
    "model.output.object",
    "model.output",
    "tool.call",
    "tool.result",
    "approval.request",
    "memory.write",
    "validation.feedback",
];

const HELPER_BOUNDARY_IDS: &[(&str, &str)] = &[
    ("boundary.input.text", "model.input.text"),
    ("boundary.input.media", "model.input.media"),
    ("boundary.input.tools", "model.input.tools"),
    ("boundary.input.instructions", "model.instructions"),
    ("boundary.output.text", "model.output.text"),
    ("boundary.output.media", "model.output.media"),
    ("boundary.output.object", "model.output.object"),
    ("boundary.output.both", "model.output"),
    ("boundary.output.path", "model.output.object"),
    ("boundary.memory.write", "memory.write"),
    ("boundary.validation.feedback", "validation.feedback"),
];

pub(crate) fn policy_id_for(config: &StaticSyntaxValue, fallback: &str) -> String {
    direct_string_property(config, "id")
        .or_else(|| direct_string_property(config, "name"))
        .unwrap_or_else(|| fallback.to_string())
}

pub(crate) fn constraint_strategy_facts(
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

pub(crate) fn guardrail_strategy_facts(
    config: &StaticSyntaxValue,
    initializers: &HashMap<&str, &StaticInitializerRecord>,
) -> Option<Value> {
    let value = property_value(config, "run")?;
    let resolved = resolve_static_value(value, initializers, &mut Default::default());
    let StaticSyntaxValue::Call { callee, args, .. } = resolved else {
        return None;
    };
    if !is_guardrail_strategy_helper(callee) {
        return None;
    }

    let mut strategy = json!({ "kind": callee.name });
    let config = args.first().and_then(|arg| {
        if callee.name == "mediaClassifier" {
            media_classifier_config_value(arg, initializers)
        } else {
            complete_config_value(arg, initializers)
        }
    });
    if let Some(config) = config {
        strategy["config"] = config;
    }
    Some(strategy)
}

fn is_guardrail_strategy_helper(callee: &StaticCalleeRecord) -> bool {
    callee.direct == Some(false)
        && GUARDRAIL_STRATEGY_KINDS.contains(&callee.name.as_str())
        && callee
            .module_specifier
            .as_deref()
            .is_some_and(|module| SAFETY_API_MODULES.contains(&module))
}

fn complete_config_value(
    value: &StaticSyntaxValue,
    initializers: &HashMap<&str, &StaticInitializerRecord>,
) -> Option<Value> {
    if has_incomplete_shape(value, initializers, &mut HashSet::new()) {
        return None;
    }
    json_value(value, initializers)
}

fn has_incomplete_shape(
    value: &StaticSyntaxValue,
    initializers: &HashMap<&str, &StaticInitializerRecord>,
    path: &mut HashSet<String>,
) -> bool {
    match value {
        StaticSyntaxValue::Identifier { name } => {
            if !path.insert(name.clone()) {
                return true;
            }
            let incomplete = initializers.get(name.as_str()).is_some_and(|initializer| {
                has_incomplete_shape(&initializer.value, initializers, path)
            });
            path.remove(name);
            incomplete
        }
        StaticSyntaxValue::Array { elements } => elements
            .iter()
            .any(|element| has_incomplete_shape(element, initializers, path)),
        StaticSyntaxValue::Object { properties, .. } => properties.iter().any(|property| {
            property.spread == Some(true)
                || has_incomplete_shape(&property.value, initializers, path)
        }),
        _ => false,
    }
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
