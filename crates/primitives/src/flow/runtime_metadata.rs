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
    for call in roots
        .iter()
        .flat_map(|root| crate::flow::facts::function_calls(root))
    {
        let Some(method) = runtime_method(call) else {
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

fn runtime_method(call: &StaticFunctionCallValue) -> Option<&'static str> {
    match call.callee.name.as_str() {
        "waitFor" => Some("waitFor"),
        "defer" => Some("defer"),
        "after" => Some("after"),
        "untilIdle" => Some("untilIdle"),
        _ => None,
    }
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
