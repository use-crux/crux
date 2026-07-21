use serde_json::{Map, Value, json};

use crate::{
    context::PrimitiveContext,
    embedding::core_values::{
        KnownTruncate, known_modalities, known_normalization, known_preprocessor_count,
        known_tasks, known_truncate, optional_string,
    },
    embedding::identity::{
        insert as insert_optional, number as number_value, sha256_hex, sorted_string_array,
        stable_json,
    },
    protocol::StaticSyntaxValue,
    record_values::{direct_string_property, number_property},
};

pub(crate) fn core_embedding_facts(
    context: &PrimitiveContext<'_>,
    config: &StaticSyntaxValue,
) -> Option<Map<String, Value>> {
    let embedding_kind = direct_string_property(config, "kind")?;
    if embedding_kind != "dense" && embedding_kind != "sparse" {
        return None;
    }
    let is_dense = embedding_kind == "dense";
    let identity = core_identity(context, config, &embedding_kind);
    let mut facts = Map::new();
    facts.insert("kind".to_string(), Value::String("embedding".to_string()));
    facts.insert("embeddingKind".to_string(), Value::String(embedding_kind));
    facts.insert("adapter".to_string(), Value::String("core".to_string()));
    if !identity.inputs.is_empty() {
        facts.insert("identityInputs".to_string(), Value::Object(identity.inputs));
    }
    if let Some(digest) = identity.digest.as_ref() {
        facts.insert("identityDigest".to_string(), Value::String(digest.clone()));
    }
    if is_dense && let (Some(name), Some(dimensions)) = (identity.name, identity.dimensions) {
        let mut space = Map::new();
        space.insert("name".to_string(), Value::String(name));
        space.insert("dimensions".to_string(), number_value(dimensions));
        if let Some(digest) = identity.digest {
            space.insert("digest".to_string(), Value::String(digest));
        }
        facts.insert("space".to_string(), Value::Object(space));
    }
    Some(facts)
}

struct CoreIdentity {
    inputs: Map<String, Value>,
    name: Option<String>,
    dimensions: Option<f64>,
    digest: Option<String>,
}

fn core_identity(
    context: &PrimitiveContext<'_>,
    config: &StaticSyntaxValue,
    embedding_kind: &str,
) -> CoreIdentity {
    let name = direct_string_property(config, "name");
    let dimensions = (embedding_kind == "dense")
        .then(|| number_property(config, "dimensions", &context.initializers))
        .flatten();
    let max_input_tokens = number_property(config, "maxInputTokens", &context.initializers);
    let modalities = known_modalities(context, config);
    let normalization = known_normalization(config, embedding_kind);
    let truncate = known_truncate(context, config);
    let version = optional_string(config, "version");
    let tasks = known_tasks(context, config);
    let preprocessor_count = known_preprocessor_count(context, config);

    let mut inputs = Map::new();
    insert_optional(&mut inputs, "name", name.clone().map(Value::String));
    insert_optional(
        &mut inputs,
        "version",
        version
            .as_ref()
            .and_then(|value| value.clone())
            .map(Value::String),
    );
    insert_optional(&mut inputs, "dimensions", dimensions.map(number_value));
    insert_optional(
        &mut inputs,
        "maxInputTokens",
        max_input_tokens.map(number_value),
    );
    insert_optional(
        &mut inputs,
        "truncate",
        truncate.as_ref().and_then(|value| value.input.clone()),
    );
    insert_optional(
        &mut inputs,
        "modalities",
        modalities.as_ref().and_then(|value| value.clone()),
    );
    insert_optional(
        &mut inputs,
        "normalization",
        normalization
            .as_ref()
            .and_then(|value| value.clone())
            .map(Value::String),
    );
    insert_optional(
        &mut inputs,
        "tasks",
        tasks
            .as_ref()
            .and_then(|value| value.as_ref())
            .map(|value| value.value.clone()),
    );
    insert_optional(
        &mut inputs,
        "preprocessorCount",
        preprocessor_count.map(|value| json!(value)),
    );

    let exact = name.is_some()
        && max_input_tokens.is_some()
        && (embedding_kind == "sparse" || dimensions.is_some())
        && modalities.as_ref().is_some_and(|value| value.is_some())
        && normalization.is_some()
        && truncate.is_some()
        && version.is_some()
        && tasks
            .as_ref()
            .is_some_and(|value| value.as_ref().is_none_or(|value| value.exact))
        && preprocessor_count == Some(0);
    let digest = exact.then(|| {
        fingerprint_digest(CoreFingerprintInput {
            embedding_kind,
            name: name.as_deref(),
            dimensions,
            max_input_tokens,
            modalities,
            normalization,
            truncate,
            version,
            tasks,
        })
    });

    CoreIdentity {
        inputs,
        name,
        dimensions,
        digest,
    }
}

struct CoreFingerprintInput<'a> {
    embedding_kind: &'a str,
    name: Option<&'a str>,
    dimensions: Option<f64>,
    max_input_tokens: Option<f64>,
    modalities: Option<Option<Value>>,
    normalization: Option<Option<String>>,
    truncate: Option<KnownTruncate>,
    version: Option<Option<String>>,
    tasks: Option<Option<crate::embedding::core_values::KnownTaskValue>>,
}

fn fingerprint_digest(input: CoreFingerprintInput<'_>) -> String {
    let mut fingerprint = Map::new();
    if let Some(dimensions) = input.dimensions {
        fingerprint.insert("dimensions".to_string(), number_value(dimensions));
    }
    fingerprint.insert(
        "kind".to_string(),
        Value::String(input.embedding_kind.to_string()),
    );
    fingerprint.insert(
        "maxInputTokens".to_string(),
        number_value(
            input
                .max_input_tokens
                .expect("exact identity has maxInputTokens"),
        ),
    );
    fingerprint.insert(
        "modalities".to_string(),
        sorted_string_array(
            input
                .modalities
                .flatten()
                .expect("exact identity has modalities"),
        ),
    );
    fingerprint.insert(
        "name".to_string(),
        Value::String(input.name.expect("exact identity has a name").to_string()),
    );
    if let Some(normalization) = input.normalization.flatten() {
        fingerprint.insert("normalization".to_string(), Value::String(normalization));
    }
    fingerprint.insert("preprocessors".to_string(), Value::Array(Vec::new()));
    if let Some(tasks) = input.tasks.flatten() {
        fingerprint.insert("tasks".to_string(), tasks.value);
    }
    fingerprint.insert(
        "truncate".to_string(),
        input
            .truncate
            .and_then(|value| value.fingerprint)
            .expect("exact identity has truncation"),
    );
    if let Some(version) = input.version.flatten() {
        fingerprint.insert("version".to_string(), Value::String(version));
    }
    sha256_hex(stable_json(&Value::Object(fingerprint)).as_bytes())
}
