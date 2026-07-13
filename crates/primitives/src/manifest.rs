//! Manifest of first-party Static Index primitive projection.
//!
//! This module is the single, explicit registry of every primitive the native
//! Static Syntax frontend can project to a complete first-party fact packet.
//! It replaces the previous opaque projector table plus ad-hoc special cases:
//! dispatch order, the `replaces` extractor identity, the matched call surface,
//! and the supported reference forms now all live in one auditable place.
//!
//! ## What the manifest owns vs what a handler owns
//!
//! Each entry declares its **contract surface** — identity, matched call and
//! constructor names, emitted definition kinds and id namespaces, the config
//! schema properties it reads, and the supported local reference forms — and
//! points at the **handler** that performs the projection. Detailed relation,
//! source-ref, and intelligence shaping stays inside the named handler: the
//! Rust static lane hand-writes projection, so the manifest's honest role is
//! registry + dispatch + audit, not a second copy of every emitted relation.
//!
//! This is the Rust *static* first-party manifest. It is distinct from the
//! TypeScript-Go *semantic* direct primitive manifest
//! (`packages/indexer/src/indexer/semantic/backends/tsgo/direct-projectors`), which
//! is data-driven because that lane projects directly from TypeScript-Go AST
//! evidence. Both describe first-party shapes; only the semantic one drives
//! projection from its own declarations.

use std::collections::HashMap;

use serde_json::Value;
use sha2::{Digest, Sha256};

use crate::{
    context::{CallParts, PrimitiveContext},
    protocol::{
        StaticImportRecord, StaticInitializerRecord, StaticNativeFactExtractorIdentity,
        StaticSourceMatch, StaticSyntaxFileRecord,
    },
};

mod entries;

pub(crate) use entries::FIRST_PARTY_PRIMITIVE_MANIFEST;

/// Canonical name of the first-party primitive manifest.
///
/// Mirrors the `primitiveManifest` component name in the Static Index run
/// identity (`crates/protocol` `StaticIndexRunIdentity`), so cache identity and
/// the projection registry name the same contract.
pub const FIRST_PARTY_PRIMITIVE_MANIFEST_NAME: &str = "crux-first-party-primitives";

/// Version of the first-party primitive manifest contract.
///
/// Bump this whenever the declared first-party projection contract changes and
/// update the Static Index primitive-manifest cache identity in the same change.
pub const FIRST_PARTY_PRIMITIVE_MANIFEST_VERSION: &str = "10";

const CRUX_CORE_EXTENSION: &str = "@use-crux/indexer/crux-core";
const CRUX_MEDIA_EXTENSION: &str = "@use-crux/indexer/crux-core-media";

/// A local reference form a projector can resolve from Static Syntax evidence.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum LocalReferenceForm {
    /// A local initializer in the same file (`const x = ...`).
    LocalInitializer,
    /// A property access chain rooted at a resolvable value (`config.value`).
    PropertyAccess,
    /// An imported symbol resolved through a same-scope dependency record.
    ImportedRecord,
}

/// Raw inputs handed to a handler that owns its own match handling.
pub(crate) struct CustomProjectionInput<'a> {
    pub file: &'a str,
    pub relative_path: &'a str,
    pub source_text: &'a str,
    pub imports: &'a [StaticImportRecord],
    pub local_initializers: &'a [StaticInitializerRecord],
    pub matches: &'a [StaticSourceMatch],
    pub match_index: usize,
    pub source_match: &'a StaticSourceMatch,
    pub records_by_file: Option<&'a HashMap<String, StaticSyntaxFileRecord>>,
}

/// How a manifest entry turns a matched source shape into first-party facts.
pub(crate) enum Projector {
    /// The common shape: resolve a call/new against shared context, then project.
    CallParts(fn(&PrimitiveContext<'_>, &CallParts<'_>) -> Option<Value>),
    /// Like `CallParts` but the projector also needs the raw file source text.
    SourceText(fn(&PrimitiveContext<'_>, &CallParts<'_>, &str) -> Option<Value>),
    /// A handler that owns its own match handling and context construction.
    Custom(fn(&CustomProjectionInput<'_>) -> Option<Value>),
}

/// One first-party primitive's projection contract and handler.
pub(crate) struct FirstPartyPrimitive {
    /// Extension identity the projected packet replaces.
    pub extension: &'static str,
    /// First-party extractor name (also the coverage-fixture family).
    pub extractor: &'static str,
    /// Coverage family; mirrors `extractor` for first-party primitives.
    pub family: &'static str,
    /// Direct call callee names this primitive projects.
    pub call_names: &'static [&'static str],
    /// `new` constructor callee names this primitive projects.
    pub constructor_names: &'static [&'static str],
    /// Definition `kind`s this primitive can emit.
    pub definition_kinds: &'static [&'static str],
    /// Definition id namespaces (`"<prefix>:"`) this primitive can emit.
    pub definition_id_prefixes: &'static [&'static str],
    /// Config properties read as input/output schemas, if any.
    pub schema_properties: &'static [&'static str],
    /// Local reference forms this primitive can resolve.
    pub local_reference_forms: &'static [LocalReferenceForm],
    /// Projection handler.
    pub projector: Projector,
    /// Whether indirect (`callee_direct == Some(false)`) calls are skipped when
    /// no cross-file dependency records are available. Only the legacy
    /// `prompt` packet narrows itself this way.
    pub skip_legacy_indirect: bool,
}

impl FirstPartyPrimitive {
    /// The extractor identity a projected packet from this primitive replaces.
    pub(crate) fn identity(&self) -> StaticNativeFactExtractorIdentity {
        StaticNativeFactExtractorIdentity {
            extension: self.extension.to_string(),
            extractor: self.extractor.to_string(),
        }
    }

    /// Whether `callee_name` is a call or constructor name this primitive projects.
    pub(crate) fn matches_callee(&self, callee_name: &str) -> bool {
        self.call_names.contains(&callee_name) || self.constructor_names.contains(&callee_name)
    }

    /// Whether this primitive resolves imported cross-file references.
    pub(crate) fn resolves_imported_records(&self) -> bool {
        self.local_reference_forms
            .contains(&LocalReferenceForm::ImportedRecord)
    }
}

/// Compact constructor that fills the constant `extension` for every entry.
///
/// The positional arguments mirror the declared contract surface so the manifest
/// table stays terse and reviewable; a builder struct would not work in const
/// context here.
#[allow(clippy::too_many_arguments)]
const fn first_party(
    extractor: &'static str,
    call_names: &'static [&'static str],
    constructor_names: &'static [&'static str],
    definition_kinds: &'static [&'static str],
    definition_id_prefixes: &'static [&'static str],
    schema_properties: &'static [&'static str],
    local_reference_forms: &'static [LocalReferenceForm],
    projector: Projector,
    skip_legacy_indirect: bool,
) -> FirstPartyPrimitive {
    FirstPartyPrimitive {
        extension: CRUX_CORE_EXTENSION,
        extractor,
        family: extractor,
        call_names,
        constructor_names,
        definition_kinds,
        definition_id_prefixes,
        schema_properties,
        local_reference_forms,
        projector,
        skip_legacy_indirect,
    }
}

#[allow(clippy::too_many_arguments)]
const fn media_party(
    extractor: &'static str,
    call_names: &'static [&'static str],
    definition_kinds: &'static [&'static str],
    definition_id_prefixes: &'static [&'static str],
    schema_properties: &'static [&'static str],
    projector: Projector,
) -> FirstPartyPrimitive {
    FirstPartyPrimitive {
        extension: CRUX_MEDIA_EXTENSION,
        extractor,
        family: extractor,
        call_names,
        constructor_names: &[],
        definition_kinds,
        definition_id_prefixes,
        schema_properties,
        local_reference_forms: &[],
        projector,
        skip_legacy_indirect: false,
    }
}

/// Stable digest of the declared first-party projection contract.
///
/// Covers the auditable surface of every entry (identity, matched names,
/// definition namespaces, schema properties, reference forms, ordering). A
/// change to the digest means the declared contract changed and should bump
/// [`FIRST_PARTY_PRIMITIVE_MANIFEST_VERSION`] and the Static Index
/// primitive-manifest cache identity in the same change.
pub fn first_party_primitive_manifest_digest() -> String {
    let mut hasher = Sha256::new();
    hasher.update(FIRST_PARTY_PRIMITIVE_MANIFEST_NAME.as_bytes());
    hasher.update(b"@");
    hasher.update(FIRST_PARTY_PRIMITIVE_MANIFEST_VERSION.as_bytes());
    for entry in FIRST_PARTY_PRIMITIVE_MANIFEST {
        hasher.update(b"\n");
        hasher.update(entry.extension.as_bytes());
        hasher.update(b"|");
        hasher.update(entry.extractor.as_bytes());
        hasher.update(b"|");
        hasher.update(entry.family.as_bytes());
        for (label, names) in [
            (b"call" as &[u8], entry.call_names),
            (b"ctor", entry.constructor_names),
            (b"kind", entry.definition_kinds),
            (b"id", entry.definition_id_prefixes),
            (b"schema", entry.schema_properties),
        ] {
            hasher.update(b"|");
            hasher.update(label);
            hasher.update(b"=");
            hasher.update(names.join(",").as_bytes());
        }
        hasher.update(b"|refs=");
        hasher.update(reference_forms_token(entry.local_reference_forms).as_bytes());
        hasher.update(b"|skip=");
        hasher.update(if entry.skip_legacy_indirect {
            b"1"
        } else {
            b"0"
        });
    }
    format!("sha256:{}", hex_lower(&hasher.finalize()))
}

fn hex_lower(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut out = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        out.push(HEX[(byte >> 4) as usize] as char);
        out.push(HEX[(byte & 0x0f) as usize] as char);
    }
    out
}

/// The replacement identity of one first-party primitive: the extension and
/// extractor a projected packet replaces, plus its coverage family.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct FirstPartyPrimitiveIdentity {
    /// Extension whose extractor output the native packet replaces.
    pub extension: &'static str,
    /// First-party extractor name.
    pub extractor: &'static str,
    /// Coverage family; mirrors `extractor` for first-party primitives.
    pub family: &'static str,
}

/// Public audit view of every first-party primitive's replacement identity, in
/// manifest order. Use this to assert manifest coverage against the shared
/// `primitive-coverage-identities` contract fixture from another crate.
pub fn first_party_primitive_identities() -> Vec<FirstPartyPrimitiveIdentity> {
    FIRST_PARTY_PRIMITIVE_MANIFEST
        .iter()
        .map(|entry| FirstPartyPrimitiveIdentity {
            extension: entry.extension,
            extractor: entry.extractor,
            family: entry.family,
        })
        .collect()
}

fn reference_forms_token(forms: &[LocalReferenceForm]) -> String {
    forms
        .iter()
        .map(|form| match form {
            LocalReferenceForm::LocalInitializer => "initializer",
            LocalReferenceForm::PropertyAccess => "property",
            LocalReferenceForm::ImportedRecord => "imported",
        })
        .collect::<Vec<_>>()
        .join(",")
}
