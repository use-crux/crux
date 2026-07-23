//! Data-only first-party completion-site manifest.
//!
//! Completion is cache-bypassing, so this manifest is deliberately separate
//! from the saved-source projection manifest and its cache identity.

use std::sync::OnceLock;

use serde::Deserialize;

static COMPLETION_SITES: OnceLock<Vec<CompletionSite>> = OnceLock::new();

/// One compiler-recognized first-party dependency slot.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CompletionSite {
    /// Direct callee names admitted for this site.
    pub call_names: Vec<String>,
    /// Object property path from the call configuration root.
    pub property_path: Vec<String>,
    /// Syntactic shape expected at the cursor.
    pub slot: CompletionSlot,
    /// Project Definition kinds compatible with the slot.
    pub accepted_kinds: Vec<String>,
    /// Edit recipe used for a compatible binding.
    pub insertion: CompletionInsertion,
    /// Whether the definition containing the slot is not a valid candidate.
    #[serde(default)]
    pub exclude_self: bool,
}

/// Supported completion syntax shapes.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum CompletionSlot {
    /// One identifier-valued object property.
    ScalarIdentifier,
    /// One identifier-valued array element.
    IdentifierArrayElement,
    /// One member in a tool-contributor object map.
    ToolMapMember,
    /// One logical identifier represented as a string.
    StaticId,
    /// One compiler-owned routing target expression.
    RoutingTarget,
}

/// Supported completion insertion recipes.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum CompletionInsertion {
    /// Replace the current identifier prefix with a binding.
    Identifier,
    /// Insert shorthand or an explicit logical-key/binding map member.
    ToolMapMember,
    /// Replace a static-ID value without rewriting its containing syntax.
    StaticId,
}

/// Returns the normalized built-in completion-site manifest.
pub fn completion_site_manifest() -> &'static [CompletionSite] {
    COMPLETION_SITES.get_or_init(|| {
        serde_json::from_str(include_str!("completion_sites.json"))
            .expect("built-in completion-site manifest is valid JSON")
    })
}
