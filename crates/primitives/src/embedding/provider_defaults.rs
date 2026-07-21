use serde_json::{Value, json};

use crate::{
    context::PrimitiveContext,
    protocol::StaticSyntaxValue,
    record_values::{json_value, property_value},
};

pub(crate) fn google_modalities(
    context: &PrimitiveContext<'_>,
    config: &StaticSyntaxValue,
    model: Option<&str>,
) -> Option<Option<Value>> {
    if let Some(value) = property_value(config, "modalities") {
        let value = json_value(value, &context.initializers)?;
        let valid = value.as_array().is_some_and(|items| {
            items.iter().all(|item| {
                item.as_str().is_some_and(|modality| {
                    matches!(modality, "text" | "image" | "audio" | "video" | "document")
                })
            })
        });
        return valid.then_some(Some(value));
    }
    Some(Some(match model {
        Some("gemini-embedding-2") => json!(["text", "image", "audio", "video", "document"]),
        Some(_) => json!(["text"]),
        None => return None,
    }))
}

pub(crate) fn openai_dimensions(model: &str) -> Option<f64> {
    match model {
        "text-embedding-ada-002" | "text-embedding-3-small" => Some(1536.0),
        "text-embedding-3-large" => Some(3072.0),
        _ => None,
    }
}
