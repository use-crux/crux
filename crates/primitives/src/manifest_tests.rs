//! Audit guards for the first-party primitive projection manifest.
//!
//! These tests pin the manifest as the single, explicit registry of first-party
//! Static Index projection. They assert it stays in bijection with the shared
//! `primitive-coverage-identities` contract fixture and that its identity digest
//! is stable, so any change to the first-party projection contract is forced to
//! be intentional and to update cache identity alongside it.

use std::collections::BTreeSet;

use serde::Deserialize;

use crate::completion::{CompletionInsertion, CompletionSlot, completion_site_manifest};
use crate::manifest::{
    FIRST_PARTY_PRIMITIVE_MANIFEST, FIRST_PARTY_PRIMITIVE_MANIFEST_NAME,
    FIRST_PARTY_PRIMITIVE_MANIFEST_VERSION, LocalReferenceForm,
    first_party_primitive_manifest_digest,
};
use crate::producer_identity::producer_identity_manifest;

const COVERAGE_FIXTURE: &str = include_str!(
    "../../../packages/indexer/src/contracts/fixtures/primitive-coverage-identities.json"
);

#[derive(Deserialize)]
struct CoverageFixture {
    identities: Vec<CoverageIdentity>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CoverageIdentity {
    extension: String,
    extractor: String,
    family: String,
    native_covered: bool,
}

fn coverage() -> CoverageFixture {
    serde_json::from_str(COVERAGE_FIXTURE).expect("coverage fixture decodes")
}

#[test]
fn manifest_is_bijective_with_first_party_coverage_fixture() {
    let manifest_extractors = FIRST_PARTY_PRIMITIVE_MANIFEST
        .iter()
        .map(|entry| entry.extractor.to_string())
        .collect::<BTreeSet<_>>();
    let fixture_extractors = coverage()
        .identities
        .iter()
        .map(|identity| identity.extractor.clone())
        .collect::<BTreeSet<_>>();

    assert_eq!(
        manifest_extractors, fixture_extractors,
        "every first-party projection must have manifest and fixture coverage with no extras"
    );
}

#[test]
fn manifest_identity_matches_first_party_coverage_contract() {
    for identity in coverage().identities {
        assert!(
            identity.native_covered,
            "{} is declared but not native-covered",
            identity.extractor
        );
        let entry = FIRST_PARTY_PRIMITIVE_MANIFEST
            .iter()
            .find(|entry| entry.extractor == identity.extractor)
            .unwrap_or_else(|| panic!("manifest is missing {}", identity.extractor));
        assert_eq!(
            entry.extension, identity.extension,
            "{} extension",
            entry.extractor
        );
        assert_eq!(
            entry.family, identity.family,
            "{} family must mirror the coverage contract",
            entry.extractor
        );
    }
}

#[test]
fn manifest_extractors_are_unique() {
    let mut seen = BTreeSet::new();
    for entry in FIRST_PARTY_PRIMITIVE_MANIFEST {
        assert!(
            seen.insert(entry.extractor),
            "duplicate first-party extractor {}",
            entry.extractor
        );
        assert!(
            !entry.call_names.is_empty(),
            "{} declares no call names",
            entry.extractor
        );
        assert!(
            !entry.definition_kinds.is_empty(),
            "{} declares no definition kinds",
            entry.extractor
        );
        assert_eq!(
            entry.definition_kinds.len(),
            entry.definition_id_prefixes.len(),
            "{} kinds and id prefixes must align",
            entry.extractor
        );
    }
}

#[test]
fn manifest_identity_is_aligned_with_static_index_cache_identity() {
    // The cache identity carries a `crux-first-party-primitives` digest component
    // (see crates/protocol StaticIndexRunIdentity.primitive_manifest). The manifest
    // owns that canonical name and version so the alignment lives in one place.
    assert_eq!(
        FIRST_PARTY_PRIMITIVE_MANIFEST_NAME,
        "crux-first-party-primitives"
    );
    assert_eq!(FIRST_PARTY_PRIMITIVE_MANIFEST_VERSION, "22");
}

#[test]
fn effect_manifest_declares_boundary_calls_and_local_only_references() {
    let effect = FIRST_PARTY_PRIMITIVE_MANIFEST
        .iter()
        .find(|entry| entry.extractor == "effect")
        .expect("Effect manifest entry");

    assert_eq!(effect.call_names, ["effect", "rollbackOnError"]);
    assert_eq!(
        effect.local_reference_forms,
        [
            LocalReferenceForm::LocalInitializer,
            LocalReferenceForm::PropertyAccess,
        ]
    );
    assert!(!effect.resolves_imported_records());
}

#[test]
fn manifest_digest_is_stable() {
    // Golden digest. If this changes you changed the declared first-party
    // projection contract: bump FIRST_PARTY_PRIMITIVE_MANIFEST_VERSION and the
    // Static Index primitive-manifest cache identity in the same change.
    assert_eq!(
        first_party_primitive_manifest_digest(),
        "sha256:6468ef2db59a6e6a03f42196a8079ffe95c2e79a2877cc6c77554fa4c817d117"
    );
}

#[test]
fn completion_manifest_covers_all_admitted_shapes() {
    let sites = completion_site_manifest();
    assert_eq!(sites.len(), 18);
    let site = sites
        .iter()
        .find(|site| site.call_names == ["agent"] && site.property_path == ["prompt"])
        .expect("agent prompt completion site");
    assert_eq!(site.call_names, ["agent"]);
    assert_eq!(site.property_path, ["prompt"]);
    assert_eq!(site.slot, CompletionSlot::ScalarIdentifier);
    assert_eq!(site.accepted_kinds, ["prompt"]);
    assert_eq!(site.insertion, CompletionInsertion::Identifier);
    assert!(!site.exclude_self);
    assert!(sites.iter().any(|site| {
        site.call_names == ["prompt"]
            && site.property_path == ["tools", "*"]
            && site.slot == CompletionSlot::ToolMapMember
            && site.insertion == CompletionInsertion::ToolMapMember
    }));
    assert!(sites.iter().any(|site| {
        site.call_names == ["agent"]
            && site.property_path == ["handoffs", "*", "id"]
            && site.slot == CompletionSlot::StaticId
            && site.insertion == CompletionInsertion::StaticId
            && site.exclude_self
    }));
    assert!(sites.iter().any(|site| {
        site.call_names == ["fallback"]
            && site.property_path == ["$args", "0", "*"]
            && site.slot == CompletionSlot::RoutingTarget
            && site.exclude_self
    }));

    assert_eq!(FIRST_PARTY_PRIMITIVE_MANIFEST_VERSION, "22");
    assert_eq!(
        first_party_primitive_manifest_digest(),
        "sha256:6468ef2db59a6e6a03f42196a8079ffe95c2e79a2877cc6c77554fa4c817d117"
    );
}

#[test]
fn producer_identity_manifest_is_unique_and_covers_completion_calls() {
    let identities = producer_identity_manifest();
    let mut seen = BTreeSet::new();
    for identity in identities {
        assert!(
            matches!(identity.match_kind.as_str(), "call" | "new"),
            "unsupported producer match kind {}",
            identity.match_kind
        );
        assert!(
            !identity.import_from.is_empty(),
            "{} has no declaring module",
            identity.name
        );
        assert!(
            seen.insert((identity.match_kind.as_str(), identity.name.as_str())),
            "duplicate producer identity {} {}",
            identity.match_kind,
            identity.name
        );
    }

    let admitted_calls = identities
        .iter()
        .filter(|identity| identity.match_kind == "call")
        .map(|identity| identity.name.as_str())
        .collect::<BTreeSet<_>>();
    for site in completion_site_manifest() {
        for call_name in &site.call_names {
            assert!(
                admitted_calls.contains(call_name.as_str()),
                "completion site {call_name} lacks producer identity"
            );
        }
    }
}
