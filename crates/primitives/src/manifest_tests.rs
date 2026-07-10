//! Audit guards for the first-party primitive projection manifest.
//!
//! These tests pin the manifest as the single, explicit registry of first-party
//! Static Index projection. They assert it stays in bijection with the shared
//! `primitive-coverage-identities` contract fixture and that its identity digest
//! is stable, so any change to the first-party projection contract is forced to
//! be intentional and to update cache identity alongside it.

use std::collections::BTreeSet;

use serde::Deserialize;

use crate::manifest::{
    FIRST_PARTY_PRIMITIVE_MANIFEST, FIRST_PARTY_PRIMITIVE_MANIFEST_NAME,
    FIRST_PARTY_PRIMITIVE_MANIFEST_VERSION, first_party_primitive_manifest_digest,
};

const COVERAGE_FIXTURE: &str =
    include_str!("../../../packages/indexer/src/contracts/fixtures/primitive-coverage-identities.json");

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
    assert_eq!(FIRST_PARTY_PRIMITIVE_MANIFEST_VERSION, "6");
}

#[test]
fn manifest_digest_is_stable() {
    // Golden digest. If this changes you changed the declared first-party
    // projection contract: bump FIRST_PARTY_PRIMITIVE_MANIFEST_VERSION and the
    // Static Index primitive-manifest cache identity in the same change.
    assert_eq!(
        first_party_primitive_manifest_digest(),
        "sha256:0268fe92801cd1ea14c5abeedd3f7024ae3e469435be4e6ba6033aae05226f54"
    );
}
