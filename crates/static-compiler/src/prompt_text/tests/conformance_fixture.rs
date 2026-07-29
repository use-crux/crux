use serde::{Deserialize, Serialize};

use super::super::analyze;
use crux_indexer_protocol::prompt_text::{
    PromptTextLimits, PromptTextQueryRequest, PromptTextQueryResponse,
};

const SOURCE: &str = include_str!(
    "../../../../../packages/indexer/__tests__/fixtures/prompt-text-editor-conformance-v1.ts"
);
const ANALYSIS: &str = include_str!(
    "../../../../../packages/indexer/__tests__/fixtures/prompt-text-editor-conformance-v1.json"
);

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Fixture {
    version: String,
    query: QueryIdentity,
    analysis: PromptTextQueryResponse,
    semantic: serde_json::Value,
    views: serde_json::Value,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct QueryIdentity {
    file: String,
    language_id: String,
    source_hash: String,
    limits: PromptTextLimits,
}

#[test]
fn one_document_matches_the_shared_editor_conformance_analysis() {
    let mut fixture: Fixture = serde_json::from_str(ANALYSIS).expect("shared conformance fixture");
    assert_eq!(fixture.version, "crux-prompt-text-editor-conformance-v1");
    let response = analyze(PromptTextQueryRequest {
        protocol_version: 1,
        file: fixture.query.file.clone(),
        language_id: fixture.query.language_id.clone(),
        revision: crux_indexer_protocol::prompt_text::PromptTextDocumentRevision {
            open_epoch: 1,
            version: 1,
            source_hash: fixture.query.source_hash.clone(),
        },
        source: SOURCE.into(),
        fragments: Vec::new(),
        fragment_joins: Vec::new(),
        limits: fixture.query.limits.clone(),
    });

    if std::env::var_os("CRUX_UPDATE_PROMPT_TEXT_CONFORMANCE").is_some() {
        fixture.analysis = response;
        let target = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join(
            "../../packages/indexer/__tests__/fixtures/prompt-text-editor-conformance-v1.json",
        );
        let mut encoded =
            serde_json::to_string_pretty(&fixture).expect("serialize conformance fixture");
        encoded.push('\n');
        std::fs::write(target, encoded).expect("write conformance fixture");
        return;
    }
    assert_eq!(response, fixture.analysis);
}
