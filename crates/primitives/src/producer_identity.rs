//! Module-qualified identities for first-party definition producers.
//!
//! This is the single ownership boundary shared by transient completion and
//! saved static projection. Syntax shape alone is insufficient: same-name
//! locals, wrappers, and unrelated re-exports must never become first-party
//! completion sites or cross-file candidates.

use std::sync::OnceLock;

use serde::Deserialize;

static PRODUCER_IDENTITIES: OnceLock<Vec<ProducerIdentity>> = OnceLock::new();

/// One compiler-recognized first-party producer.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProducerIdentity {
    /// Syntax form that invokes the producer (`call` or `new`).
    pub match_kind: String,
    /// Imported function or constructor name.
    pub name: String,
    /// Exact public modules allowed to declare the producer.
    pub import_from: Vec<String>,
}

/// Returns the normalized first-party producer identity manifest.
pub fn producer_identity_manifest() -> &'static [ProducerIdentity] {
    PRODUCER_IDENTITIES.get_or_init(|| {
        serde_json::from_str(include_str!("producer_identities.json"))
            .expect("built-in producer identity manifest is valid JSON")
    })
}

/// Tests whether resolved syntax proves one first-party producer identity.
pub fn is_first_party_producer(
    match_kind: &str,
    name: &str,
    module_specifier: Option<&str>,
) -> bool {
    let Some(module_specifier) = module_specifier else {
        return false;
    };
    producer_identity_manifest().iter().any(|identity| {
        identity.match_kind == match_kind
            && identity.name == name
            && identity
                .import_from
                .iter()
                .any(|module| module == module_specifier)
    })
}
