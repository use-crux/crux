use std::collections::HashMap;

use crate::protocol::{SourceLocation, StaticFunctionCallValue, StaticSyntaxValue};

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct FlowRuntimeUsage {
    method: String,
    source: SourceLocation,
    #[serde(skip_serializing_if = "Option::is_none")]
    closure_target: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    non_serializable_payload: Option<String>,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct FlowNondeterministicCall {
    expression: String,
    source: SourceLocation,
}

pub(crate) fn flow_runtime_usages(roots: &[&StaticSyntaxValue]) -> Vec<impl serde::Serialize> {
    let mut usages = Vec::new();
    for root in roots {
        let runtime_bindings = function_runtime_bindings(root);
        for call in crate::flow::facts::function_calls(root) {
            let Some(method) = runtime_method(call, &runtime_bindings) else {
                continue;
            };
            let payload = match method {
                "defer" => call.args.get(1),
                "after" => call.args.get(2),
                _ => None,
            };
            usages.push(FlowRuntimeUsage {
                method: method.to_string(),
                source: call.source.clone(),
                closure_target: if method == "defer" && is_function_value(call.args.first()) {
                    Some(true)
                } else {
                    None
                },
                non_serializable_payload: payload.and_then(non_serializable_payload),
            });
        }
    }
    usages
}

pub(crate) fn flow_nondeterministic_calls(
    roots: &[&StaticSyntaxValue],
) -> Vec<impl serde::Serialize> {
    let mut calls = Vec::new();
    for call in roots
        .iter()
        .flat_map(|root| crate::flow::facts::function_calls(root))
    {
        if call.callee.name == "now" && receiver_identifier(call) == Some("Date") {
            calls.push(FlowNondeterministicCall {
                expression: "Date.now".to_string(),
                source: call.source.clone(),
            });
        }
        if call.callee.name == "random" && receiver_identifier(call) == Some("Math") {
            calls.push(FlowNondeterministicCall {
                expression: "Math.random".to_string(),
                source: call.source.clone(),
            });
        }
    }
    calls
}

fn runtime_method(
    call: &StaticFunctionCallValue,
    runtime_bindings: &HashMap<String, RuntimeBinding>,
) -> Option<&'static str> {
    if let Some(receiver) = receiver_identifier(call) {
        if runtime_bindings.get(receiver) != Some(&RuntimeBinding::Scope) {
            return None;
        }
        return runtime_method_name(&call.callee.name);
    }
    let local_name = call
        .callee
        .local_name
        .as_deref()
        .unwrap_or(&call.callee.name);
    match runtime_bindings.get(local_name) {
        Some(RuntimeBinding::Method(method)) => Some(method),
        _ => None,
    }
}

fn runtime_method_name(name: &str) -> Option<&'static str> {
    match name {
        "waitFor" => Some("waitFor"),
        "defer" => Some("defer"),
        "after" => Some("after"),
        "untilIdle" => Some("untilIdle"),
        _ => None,
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum RuntimeBinding {
    Scope,
    Method(&'static str),
}

fn function_runtime_bindings(root: &StaticSyntaxValue) -> HashMap<String, RuntimeBinding> {
    let mut bindings = HashMap::new();
    if let StaticSyntaxValue::Function {
        first_parameter_bindings,
        ..
    } = root
    {
        for binding in first_parameter_bindings {
            if let Some(method) = runtime_method_name(
                binding
                    .property_name
                    .as_deref()
                    .unwrap_or(binding.name.as_str()),
            ) {
                bindings.insert(binding.name.clone(), RuntimeBinding::Method(method));
            } else if binding.property_name.is_none() {
                bindings.insert(binding.name.clone(), RuntimeBinding::Scope);
            }
        }
    }
    bindings
}

fn receiver_identifier(call: &StaticFunctionCallValue) -> Option<&str> {
    match call.receiver.as_deref() {
        Some(StaticSyntaxValue::Identifier { name }) => Some(name),
        _ => None,
    }
}

fn non_serializable_payload(value: &StaticSyntaxValue) -> Option<String> {
    match value {
        StaticSyntaxValue::Function { .. } => Some("function".to_string()),
        StaticSyntaxValue::Unsupported { syntax_kind, .. } => Some(syntax_kind.clone()),
        _ => None,
    }
}

fn is_function_value(value: Option<&StaticSyntaxValue>) -> bool {
    matches!(value, Some(StaticSyntaxValue::Function { .. }))
}
