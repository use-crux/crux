use serde::Deserialize;

#[derive(Deserialize)]
struct ContractManifest {
    groups: Vec<ContractManifestGroup>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ContractManifestGroup {
    id: String,
    mirror_status: String,
    fixtures: Vec<String>,
    mirrors: ContractManifestMirrors,
}

#[derive(Deserialize)]
struct ContractManifestMirrors {
    rust: Vec<String>,
}

#[test]
fn rust_shared_fixture_tests_are_declared_by_contract_manifest() {
    let manifest: ContractManifest = serde_json::from_str(include_str!(
        "../../../packages/indexer/src/contracts/contract-manifest.json"
    ))
    .expect("contract manifest should decode");

    assert_manifest_group(
        &manifest,
        "static-index",
        &[
            "packages/indexer/src/contracts/fixtures/static-index-identity.json",
            "packages/indexer/src/contracts/fixtures/static-index-protocol.json",
            "packages/indexer/src/contracts/fixtures/static-index-protocol-cases.json",
        ],
    );
    assert_manifest_group(
        &manifest,
        "static-syntax-records",
        &[
            "packages/indexer/src/contracts/fixtures/static-syntax-records.json",
            "packages/indexer/src/contracts/fixtures/static-syntax-record-cases.json",
        ],
    );
    assert_manifest_group(
        &manifest,
        "worker-events",
        &[
            "packages/indexer/src/contracts/fixtures/worker-events.json",
            "packages/indexer/src/contracts/fixtures/worker-event-cases.json",
        ],
    );
}

fn assert_manifest_group(manifest: &ContractManifest, id: &str, fixture_paths: &[&str]) {
    let group = manifest_group(manifest, id);
    assert_eq!(group.mirror_status, "checked-mirror");
    assert!(
        group
            .mirrors
            .rust
            .iter()
            .any(|path| path == "crates/static-compiler/src/shared_fixtures_tests.rs"),
        "{id} should list Rust shared fixture coverage"
    );
    for path in fixture_paths {
        assert!(
            group.fixtures.iter().any(|fixture| fixture == path),
            "{id} should list fixture {path}"
        );
    }
}

fn manifest_group<'a>(manifest: &'a ContractManifest, id: &str) -> &'a ContractManifestGroup {
    manifest
        .groups
        .iter()
        .find(|group| group.id == id)
        .unwrap_or_else(|| panic!("contract manifest missing group {id}"))
}
