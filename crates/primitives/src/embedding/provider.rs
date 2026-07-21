use serde_json::{Map, Value, json};

use crate::{
    context::PrimitiveContext,
    embedding::{
        core_values::KnownTaskValue,
        identity::{insert, number, provider_fingerprint, sha256_hex, stable_json},
        provider_defaults::{google_modalities, openai_dimensions},
        provider_values::{
            default_number, default_string, optional_boolean, optional_string, optional_tasks,
            required_number, required_string,
        },
    },
    protocol::StaticSyntaxValue,
    record_values::direct_string_property,
};

const GOOGLE_MODULE: &str = "@use-crux/google";
const OPENAI_MODULE: &str = "@use-crux/openai";
const AI_SDK_MODULE: &str = "@use-crux/ai";

/// Projects provider-resolved defaults without importing provider SDK types.
pub(crate) fn provider_embedding_facts(
    context: &PrimitiveContext<'_>,
    config: &StaticSyntaxValue,
    module: &str,
) -> Option<Map<String, Value>> {
    let resolved = match module {
        GOOGLE_MODULE => google_identity(context, config),
        OPENAI_MODULE => openai_identity(context, config),
        AI_SDK_MODULE => ai_sdk_identity(context, config),
        _ => return None,
    };
    let mut facts = Map::new();
    facts.insert("kind".to_string(), Value::String("embedding".to_string()));
    facts.insert(
        "embeddingKind".to_string(),
        Value::String("dense".to_string()),
    );
    facts.insert(
        "adapter".to_string(),
        Value::String(resolved.adapter.to_string()),
    );
    if let Some(model) = resolved.model {
        facts.insert("model".to_string(), Value::String(model));
    }
    facts.insert(
        "identityInputs".to_string(),
        Value::Object(resolved.inputs.clone()),
    );
    let digest = if resolved.complete {
        let fingerprint = provider_fingerprint(&resolved.inputs);
        let digest = sha256_hex(fingerprint.as_bytes());
        facts.insert("identityDigest".to_string(), Value::String(digest.clone()));
        Some(digest)
    } else {
        None
    };
    if let (Some(name), Some(dimensions)) = (
        resolved.inputs.get("name").and_then(Value::as_str),
        resolved.inputs.get("dimensions").and_then(Value::as_f64),
    ) {
        let mut space = Map::new();
        space.insert("name".to_string(), Value::String(name.to_string()));
        space.insert("dimensions".to_string(), number(dimensions));
        if let Some(digest) = digest {
            space.insert("digest".to_string(), Value::String(digest));
        }
        facts.insert("space".to_string(), Value::Object(space));
    }
    Some(facts)
}

struct ProviderIdentity {
    adapter: &'static str,
    model: Option<String>,
    inputs: Map<String, Value>,
    complete: bool,
}

fn google_identity(context: &PrimitiveContext<'_>, config: &StaticSyntaxValue) -> ProviderIdentity {
    let model = direct_string_property(config, "model");
    let name = default_string(config, "name", model.clone());
    let dimensions = default_number(
        context,
        config,
        "dimensions",
        (model.as_deref() == Some("gemini-embedding-2")).then_some(3072.0),
    );
    let max_input_tokens = default_number(
        context,
        config,
        "maxInputTokens",
        (model.as_deref() == Some("gemini-embedding-2")).then_some(8192.0),
    );
    let modalities = google_modalities(context, config, model.as_deref());
    let tasks = optional_tasks(context, config);
    let authored_version = optional_string(config, "version");
    let title = optional_string(config, "title");
    let mime_type = optional_string(config, "mimeType");
    let auto_truncate = optional_boolean(context, config, "autoTruncate");
    let version = match (
        model.as_deref(),
        tasks.as_ref(),
        authored_version.as_ref(),
        title.as_ref(),
        mime_type.as_ref(),
        auto_truncate.as_ref(),
    ) {
        (Some(model), Some(tasks), Some(authored), Some(title), Some(mime), Some(auto)) => {
            let query = tasks
                .as_ref()
                .map(|value| &value.value)
                .and_then(|value| value.get("query"))
                .and_then(Value::as_str);
            let document = tasks
                .as_ref()
                .map(|value| &value.value)
                .and_then(|value| value.get("document"))
                .and_then(Value::as_str);
            Some(format!(
                "google:model={};tasks.query={};tasks.document={};title={};mimeType={};autoTruncate={}{}",
                quoted(model),
                identity_string(query),
                identity_string(document),
                identity_optional(title.as_ref()),
                identity_optional(mime.as_ref()),
                identity_json(auto.as_ref()),
                authored
                    .as_ref()
                    .map(|value| format!(";version={}", quoted(value)))
                    .unwrap_or_default(),
            ))
        }
        _ => None,
    };
    provider_identity(
        "google",
        model,
        name,
        dimensions,
        max_input_tokens,
        modalities,
        tasks,
        version,
    )
}

fn openai_identity(context: &PrimitiveContext<'_>, config: &StaticSyntaxValue) -> ProviderIdentity {
    let model = direct_string_property(config, "model");
    let dimensions = default_number(
        context,
        config,
        "dimensions",
        model.as_deref().and_then(openai_dimensions),
    );
    let authored_version = optional_string(config, "version");
    let version = model
        .as_ref()
        .zip(authored_version.as_ref())
        .map(|(model, version)| {
            format!(
                "openai:model={}{}",
                quoted(model),
                version
                    .as_ref()
                    .map(|value| format!(";version={}", quoted(value)))
                    .unwrap_or_default()
            )
        });
    provider_identity(
        "openai",
        model,
        required_string(config, "name"),
        dimensions,
        default_number(context, config, "maxInputTokens", Some(8192.0)),
        Some(Some(json!(["text"]))),
        Some(None),
        version,
    )
}

fn ai_sdk_identity(context: &PrimitiveContext<'_>, config: &StaticSyntaxValue) -> ProviderIdentity {
    let model = direct_string_property(config, "model");
    let authored_version = optional_string(config, "version");
    let version = model
        .as_ref()
        .zip(authored_version.as_ref())
        .map(|(model, version)| {
            format!(
                "ai-sdk:model={}{}",
                quoted(model),
                version
                    .as_ref()
                    .map(|value| format!(";version={}", quoted(value)))
                    .unwrap_or_default()
            )
        });
    provider_identity(
        "ai-sdk",
        model,
        required_string(config, "name"),
        required_number(context, config, "dimensions"),
        required_number(context, config, "maxInputTokens"),
        Some(Some(json!(["text"]))),
        Some(None),
        version,
    )
}

#[allow(clippy::too_many_arguments)]
fn provider_identity(
    adapter: &'static str,
    model: Option<String>,
    name: Option<Option<String>>,
    dimensions: Option<Option<f64>>,
    max_input_tokens: Option<Option<f64>>,
    modalities: Option<Option<Value>>,
    tasks: Option<Option<KnownTaskValue>>,
    version: Option<String>,
) -> ProviderIdentity {
    let mut inputs = Map::new();
    insert(
        &mut inputs,
        "name",
        name.as_ref()
            .and_then(|value| value.clone())
            .map(Value::String),
    );
    insert(&mut inputs, "version", version.clone().map(Value::String));
    insert(&mut inputs, "dimensions", dimensions.flatten().map(number));
    insert(
        &mut inputs,
        "maxInputTokens",
        max_input_tokens.flatten().map(number),
    );
    inputs.insert("truncate".to_string(), json!({ "strategy": "fail" }));
    insert(
        &mut inputs,
        "modalities",
        modalities.as_ref().and_then(|value| value.clone()),
    );
    inputs.insert(
        "normalization".to_string(),
        Value::String("unknown".to_string()),
    );
    insert(
        &mut inputs,
        "tasks",
        tasks
            .as_ref()
            .and_then(|value| value.as_ref())
            .map(|value| value.value.clone()),
    );
    inputs.insert("preprocessorCount".to_string(), json!(0));
    ProviderIdentity {
        adapter,
        model,
        inputs,
        complete: name.is_some_and(|value| value.is_some())
            && dimensions.is_some_and(|value| value.is_some())
            && max_input_tokens.is_some_and(|value| value.is_some())
            && modalities.is_some_and(|value| value.is_some())
            && tasks
                .as_ref()
                .is_some_and(|value| value.as_ref().is_none_or(|value| value.exact))
            && version.is_some(),
    }
}

fn quoted(value: &str) -> String {
    serde_json::to_string(value).expect("strings serialize")
}

fn identity_string(value: Option<&str>) -> String {
    value.map(quoted).unwrap_or_else(|| "default".to_string())
}

fn identity_optional(value: Option<&String>) -> String {
    value
        .map(|value| quoted(value))
        .unwrap_or_else(|| "default".to_string())
}

fn identity_json(value: Option<&Value>) -> String {
    value
        .map(stable_json)
        .unwrap_or_else(|| "default".to_string())
}
