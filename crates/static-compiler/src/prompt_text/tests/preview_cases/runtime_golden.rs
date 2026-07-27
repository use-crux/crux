use serde::Deserialize;

use super::super::{analyze, request};

const FIXTURE: &str = include_str!(
    "../../../../../../packages/core/__tests__/fixtures/prompt-text-preview-runtime-v1.json"
);

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Fixture {
    version: String,
    cases: Vec<RuntimeCase>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RuntimeCase {
    name: String,
    source: String,
    candidate_id: u32,
    text: String,
}

#[test]
fn preview_matches_shared_core_runtime_bytes() {
    let fixture: Fixture = serde_json::from_str(FIXTURE).expect("shared preview fixture");
    assert_eq!(fixture.version, "crux-prompt-text-preview-runtime-v1");

    for test_case in fixture.cases {
        let response = analyze(request(&test_case.source));
        let preview = &response.templates[test_case.candidate_id as usize].preview;
        assert_eq!(
            preview.text, test_case.text,
            "shared runtime fixture: {}",
            test_case.name,
        );
        assert_eq!(
            preview
                .segments
                .iter()
                .map(segment_text)
                .collect::<String>(),
            preview.text,
            "shared runtime fixture reconstruction: {}",
            test_case.name,
        );
    }
}

fn segment_text(segment: &crux_indexer_protocol::prompt_text::PromptTextPreviewSegment) -> &str {
    use crux_indexer_protocol::prompt_text::PromptTextPreviewSegment;
    match segment {
        PromptTextPreviewSegment::AuthoredLiteral { text, .. }
        | PromptTextPreviewSegment::KnownValue { text, .. }
        | PromptTextPreviewSegment::Fragment { text, .. }
        | PromptTextPreviewSegment::Placeholder { text, .. } => text,
    }
}
