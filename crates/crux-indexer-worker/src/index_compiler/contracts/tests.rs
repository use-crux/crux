use serde_json::json;

use crate::index_compiler::core::facts::{
    NativeStaticDefinition, NativeStaticFidelity, NativeStaticRelation,
};
use crate::index_compiler::read::model::with_resolved_relation_read_model;
use crate::index_compiler::relation::model::relation_identity;

#[test]
fn expanded_input_contracts_include_required_context_inputs() {
    let definitions = with_resolved_relation_read_model(
        vec![
            definition(
                "prompt:answer",
                "prompt",
                "answer",
                Some(json!({
                    "inputSchema": {
                        "type": "object",
                        "additionalProperties": false,
                        "properties": { "question": { "type": "string" } },
                        "required": ["question"]
                    },
                    "facts": {
                        "kind": "prompt",
                        "useEntries": [{ "variable": "locale", "via": "direct", "conditionality": "always" }]
                    },
                    "intelligence": {
                        "confidence": "static",
                        "contract": {
                            "inputSchema": {
                                "type": "object",
                                "additionalProperties": false,
                                "properties": { "question": { "type": "string" } },
                                "required": ["question"]
                            }
                        }
                    }
                })),
            ),
            definition(
                "context:locale",
                "context",
                "locale",
                Some(json!({
                    "inputSchema": {
                        "type": "object",
                        "properties": {
                            "locale": { "type": "string", "enum": ["en", "nl"] }
                        },
                        "required": ["locale"]
                    },
                    "facts": { "kind": "context" },
                    "intelligence": {
                        "confidence": "static",
                        "contract": {
                            "inputSchema": {
                                "type": "object",
                                "properties": {
                                    "locale": { "type": "string", "enum": ["en", "nl"] }
                                },
                                "required": ["locale"]
                            }
                        }
                    }
                })),
            ),
        ],
        &[relation(
            "prompt.uses_context",
            "prompt:answer",
            "context:locale",
            NativeStaticFidelity::Resolved,
        )],
    );

    let prompt = definitions
        .iter()
        .find(|definition| definition.id == "prompt:answer")
        .expect("prompt definition");
    let contract = &prompt.metadata.as_ref().unwrap()["intelligence"]["contract"];
    assert_eq!(
        contract["expandedInputSchema"]["required"],
        json!(["question", "locale"])
    );
    assert_eq!(
        contract["inputContributions"][0]["path"],
        json!(["prompt:answer", "context:locale"])
    );
    assert_eq!(contract["inputContributions"][0]["required"], true);
}

fn definition(
    id: &str,
    kind: &str,
    name: &str,
    metadata: Option<serde_json::Value>,
) -> NativeStaticDefinition {
    NativeStaticDefinition {
        id: id.to_string(),
        kind: kind.to_string(),
        name: name.to_string(),
        description: None,
        tags: Vec::new(),
        path: Vec::new(),
        source: None,
        source_snippet: None,
        source_refs: Vec::new(),
        fidelity: NativeStaticFidelity::Resolved,
        status: Some("active".to_string()),
        fingerprint: None,
        metadata,
        quality: None,
    }
}

fn relation(
    relation_type: &str,
    from: &str,
    to: &str,
    fidelity: NativeStaticFidelity,
) -> NativeStaticRelation {
    NativeStaticRelation {
        id: relation_identity(relation_type, from, to),
        r#type: relation_type.to_string(),
        from: from.to_string(),
        to: to.to_string(),
        fidelity,
        source: None,
        metadata: None,
    }
}
