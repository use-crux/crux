use serde_json::{Map, Value, json};

use crate::primitives::data_access::DataAccessRef;

pub(crate) fn primitive_data_intelligence(accesses: &[DataAccessRef]) -> Option<Value> {
    if accesses.is_empty() {
        return None;
    }
    let reads = accesses
        .iter()
        .filter(|access| access.kind == "read")
        .map(access_metadata)
        .collect::<Vec<_>>();
    let writes = accesses
        .iter()
        .filter(|access| access.kind == "write")
        .map(access_metadata)
        .collect::<Vec<_>>();
    let mut data = Map::new();
    if !reads.is_empty() {
        data.insert("reads".to_string(), Value::Array(reads));
    }
    if !writes.is_empty() {
        data.insert("writes".to_string(), Value::Array(writes));
    }
    Some(json!({
        "confidence": "static",
        "data": Value::Object(data),
    }))
}

pub(crate) fn data_access_relation_refs(
    from_id: &str,
    accesses: &[DataAccessRef],
    owner: &str,
) -> Vec<Value> {
    accesses
        .iter()
        .map(|access| {
            let relation = if access.kind == "read" {
                format!("{owner}.reads_memory")
            } else {
                format!("{owner}.writes_memory")
            };
            let type_by_target_kind = if access.kind == "read" {
                json!({
                    "memory": format!("{owner}.reads_memory"),
                    "blackboard": format!("{owner}.reads_blackboard"),
                    "workspace": format!("{owner}.reads_workspace"),
                })
            } else {
                json!({
                    "memory": format!("{owner}.writes_memory"),
                    "blackboard": format!("{owner}.writes_blackboard"),
                    "workspace": format!("{owner}.writes_workspace"),
                })
            };
            json!({
                "type": relation,
                "typeByTargetKind": type_by_target_kind,
                "fromId": from_id,
                "toVariable": access.target_variable,
            })
        })
        .collect()
}

fn access_metadata(access: &DataAccessRef) -> Value {
    let mut value = Map::new();
    value.insert(
        "targetVariable".to_string(),
        Value::String(access.target_variable.clone()),
    );
    if let Some(target_kind) = access.target_kind {
        value.insert(
            "targetKind".to_string(),
            Value::String(target_kind.to_string()),
        );
    }
    value.insert(
        "operation".to_string(),
        Value::String(access.operation.to_string()),
    );
    if let Some(key) = &access.key {
        value.insert("key".to_string(), Value::String(key.clone()));
    }
    value.insert("source".to_string(), json!(access.source));
    Value::Object(value)
}
