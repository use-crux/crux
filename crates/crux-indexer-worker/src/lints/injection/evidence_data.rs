//! JSON evidence payload helpers for native injection lint rules.

use serde_json::{Map, Value, json};

use crate::index_compiler::core::facts::NativeStaticDefinition;

pub(crate) fn input_contribution_evidence(
    owner: &NativeStaticDefinition,
    contribution: &Value,
    label: &str,
) -> Value {
    generic_contribution_evidence(
        owner,
        contribution,
        label,
        &[
            "field",
            "sourceDefinitionId",
            "sourceName",
            "sourceKind",
            "required",
            "conditionality",
            "branch",
            "via",
            "path",
            "schema",
        ],
    )
}

pub(crate) fn generic_contribution_evidence(
    owner: &NativeStaticDefinition,
    contribution: &Value,
    label: &str,
    keys: &[&str],
) -> Value {
    let mut data = Map::new();
    for key in keys {
        if let Some(value) = contribution.get(*key) {
            data.insert((*key).to_string(), value.clone());
        }
    }
    json!({ "kind": "definition", "label": label,
        "definitionId": contribution.get("sourceDefinitionId")
            .and_then(Value::as_str).unwrap_or(owner.id.as_str()),
        "source": owner.source, "data": Value::Object(data) })
}
