use serde_json::{Map, Value, json};

use crate::{
    context::{CallParts, PrimitiveContext, ResolvedSource},
    data::access::primitive_data_intelligence,
    data::output::data_access_relation_refs,
    definition::{
        NativeDefinitionInput, folded_index_child, safe_id, source_ref, static_index_definition,
    },
    flow::facts::{FlowStep, FlowSuspension, function_calls},
    protocol::{StaticFunctionCallValue, StaticSyntaxValue},
};

pub(crate) fn step_definitions(
    context: &PrimitiveContext<'_>,
    parts: &CallParts<'_>,
    flow_id: &str,
    flow_key: &str,
    step_names: &[String],
    steps: &[FlowStep],
) -> Vec<Value> {
    step_names
        .iter()
        .enumerate()
        .map(|(index, step_name)| {
            let definition_id = format!("flow.step:{}:{}", safe_id(flow_key), safe_id(step_name));
            let accesses = steps
                .iter()
                .filter(|step| step.name == *step_name)
                .flat_map(|step| step.data_accesses.clone())
                .collect::<Vec<_>>();
            let mut metadata = Map::new();
            metadata.insert(
                "exportName".to_string(),
                Value::String(parts.variable_name.to_string()),
            );
            metadata.insert("flowId".to_string(), Value::String(flow_id.to_string()));
            metadata.insert("static".to_string(), Value::Bool(true));
            metadata.insert(
                "indexPresentation".to_string(),
                folded_index_child(flow_id, "flow.includes_step", "step", index),
            );
            metadata.insert(
                "facts".to_string(),
                json!({
                    "kind": "flow.step",
                    "flowId": flow_id,
                    "stepLabel": step_name,
                }),
            );
            if let Some(intelligence) = primitive_data_intelligence(&accesses) {
                metadata.insert("intelligence".to_string(), intelligence);
            }
            let mut definition = static_index_definition(NativeDefinitionInput {
                id: definition_id,
                kind: "flow.step",
                name: step_name.clone(),
                file: context.file,
                source: parts.source,
                snippet: parts.snippet,
                metadata,
            });
            insert_definition_source_refs(
                &mut definition,
                steps
                    .iter()
                    .filter(|step| step.name == *step_name)
                    .flat_map(|step| step.source_refs.clone())
                    .collect(),
            );
            definition
        })
        .collect()
}

pub(crate) fn flow_references(
    step_ids: &[(String, String)],
    steps: &[FlowStep],
    suspensions: &[FlowSuspension],
) -> Vec<Value> {
    let mut refs = step_ids
        .iter()
        .map(|(_, id)| json!({ "type": "flow.includes_step", "toId": id }))
        .collect::<Vec<_>>();
    for step in steps {
        let Some(step_id) = step_id_for_name(step_ids, &step.name) else {
            continue;
        };
        if let Some(target) = &step.target_variable {
            refs.push(json!({
                "type": "flow.step.uses_agent",
                "typeByTargetKind": {
                    "agent": "flow.step.uses_agent",
                    "prompt": "flow.step.uses_prompt",
                    "tool": "flow.step.uses_tool",
                    "memory": "flow.step.uses_memory",
                    "blackboard": "flow.step.uses_blackboard",
                    "routing.router": "flow.step.uses_routing",
                    "routing.cascade": "flow.step.uses_routing",
                    "routing.fallback": "flow.step.uses_routing",
                },
                "toVariable": target,
                "fromId": step_id,
            }));
        }
    }
    for suspension in suspensions {
        let Some(step_id) = suspension
            .step_name
            .as_ref()
            .and_then(|name| step_id_for_name(step_ids, name))
        else {
            continue;
        };
        refs.push(json!({
            "type": "flow.step.waits_for_signal",
            "toId": format!("signal:{}", safe_id(&suspension.signal)),
            "fromId": step_id,
        }));
    }
    for step in steps {
        let Some(step_id) = step_id_for_name(step_ids, &step.name) else {
            continue;
        };
        refs.extend(data_access_relation_refs(
            step_id,
            &step.data_accesses,
            "flow.step",
        ));
    }
    refs
}

pub(crate) fn step_target_source_refs(
    context: &PrimitiveContext<'_>,
    definition_id: &str,
    target_variable: &str,
) -> Option<Vec<Value>> {
    let identifier = StaticSyntaxValue::Identifier {
        name: target_variable.to_string(),
    };
    let Some(resolved) = context.resolve_record_source(Some(&identifier))? else {
        return Some(Vec::new());
    };
    let mut refs = vec![source_ref(
        definition_id,
        "handler",
        "step",
        &resolved.symbol,
        &resolved.source,
        resolved.function_name.as_deref(),
        resolved.snippet.as_ref(),
    )];
    refs.extend(helper_source_refs(context, definition_id, &resolved)?);
    Some(refs)
}

pub(crate) fn flow_fact_metadata(step_names: &[String], has_args: bool, runtime: &str) -> Value {
    json!({
        "kind": "flow",
        "stepNames": step_names,
        "hasArgs": has_args,
        "runtime": runtime,
    })
}

pub(crate) fn flow_intelligence(
    runtime: &str,
    args_schema: Option<&Value>,
    suspensions: &[FlowSuspension],
    step_ids: &[(String, String)],
) -> Value {
    let mut control = Map::new();
    control.insert(
        "mode".to_string(),
        Value::String(
            if runtime == "convex" {
                "durable"
            } else {
                "immediate"
            }
            .to_string(),
        ),
    );
    control.insert("ordering".to_string(), Value::String("ordered".to_string()));
    if !step_ids.is_empty() {
        control.insert(
            "children".to_string(),
            json!(step_ids.iter().map(|(_, id)| id).collect::<Vec<_>>()),
        );
    }
    if !suspensions.is_empty() {
        control.insert(
            "suspensionPoints".to_string(),
            Value::Array(
                suspensions
                    .iter()
                    .map(|item| {
                        json!({ "id": item.signal, "label": item.signal, "signal": item.signal })
                    })
                    .collect(),
            ),
        );
    }
    let mut intelligence = Map::new();
    intelligence.insert(
        "confidence".to_string(),
        Value::String("static".to_string()),
    );
    if let Some(schema) = args_schema {
        intelligence.insert("contract".to_string(), json!({ "argsSchema": schema }));
    }
    intelligence.insert("control".to_string(), Value::Object(control));
    Value::Object(intelligence)
}

fn helper_source_refs(
    context: &PrimitiveContext<'_>,
    definition_id: &str,
    resolved: &ResolvedSource<'_>,
) -> Option<Vec<Value>> {
    let mut refs = Vec::new();
    for symbol in function_calls(resolved.value)
        .iter()
        .filter_map(helper_call_symbol)
    {
        let identifier = StaticSyntaxValue::Identifier {
            name: symbol.to_string(),
        };
        let Some(helper) = context.resolve_record_source(Some(&identifier))? else {
            continue;
        };
        if !matches!(helper.value, StaticSyntaxValue::Function { .. }) {
            continue;
        }
        refs.push(source_ref(
            definition_id,
            "helper",
            symbol,
            &helper.symbol,
            &helper.source,
            helper.function_name.as_deref(),
            helper.snippet.as_ref(),
        ));
    }
    Some(refs)
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

fn step_id_for_name<'a>(step_ids: &'a [(String, String)], name: &str) -> Option<&'a str> {
    step_ids
        .iter()
        .find(|(step_name, _)| step_name == name)
        .map(|(_, id)| id.as_str())
}

fn insert_definition_source_refs(definition: &mut Value, source_refs: Vec<Value>) {
    if source_refs.is_empty() {
        return;
    }
    let Value::Object(definition) = definition else {
        return;
    };
    definition.insert(
        "sourceRefs".to_string(),
        Value::Array(
            source_refs
                .into_iter()
                .filter_map(|item| item.get("ref").cloned())
                .collect(),
        ),
    );
}
