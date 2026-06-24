use serde_json::{Map, Value, json};

use crate::primitives::runtime::join::{metadata_string, strip_definition_prefix};

pub(crate) fn flow_runtime_join(
    kind: &str,
    name: &str,
    metadata: &Map<String, Value>,
    span_attributes: &mut Map<String, Value>,
    runtime_join: &mut Map<String, Value>,
) {
    match kind {
        "flow" => flow_join(name, runtime_join),
        "flow.step" => flow_step_join(name, metadata, span_attributes, runtime_join),
        _ => {}
    }
}

fn flow_join(name: &str, runtime_join: &mut Map<String, Value>) {
    runtime_join.insert(
        "primitive".to_string(),
        Value::String("flow.run".to_string()),
    );
    runtime_join.insert("spanName".to_string(), Value::String(name.to_string()));
    runtime_join.insert(
        "correlationAttributes".to_string(),
        json!(["flowId", "parentFlowId"]),
    );
}

fn flow_step_join(
    name: &str,
    metadata: &Map<String, Value>,
    span_attributes: &mut Map<String, Value>,
    runtime_join: &mut Map<String, Value>,
) {
    span_attributes.insert("stepLabel".to_string(), Value::String(name.to_string()));
    runtime_join.insert(
        "primitive".to_string(),
        Value::String("flow.step".to_string()),
    );
    runtime_join.insert("spanName".to_string(), Value::String(name.to_string()));
    runtime_join.insert("stepLabel".to_string(), Value::String(name.to_string()));
    if let Some(flow_id) = metadata_string(metadata, "flowId") {
        runtime_join.insert(
            "parentDefinitionId".to_string(),
            Value::String(flow_id.clone()),
        );
        runtime_join.insert(
            "flowName".to_string(),
            Value::String(strip_definition_prefix(&flow_id, "flow:").to_string()),
        );
    }
    runtime_join.insert(
        "correlationAttributes".to_string(),
        json!(["flowId", "stepId"]),
    );
}
