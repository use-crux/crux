use std::time::{Duration, Instant};

use crux_indexer_protocol::prompt_text::PromptTextAnalysisStatus;

use super::{analyze, request};

#[test]
fn large_commonmark_projection_stays_within_the_release_budget() {
    let body = (0..2_048)
        .map(|index| format!("## Heading {index} with **strong** and [link](https://example.com)"))
        .collect::<Vec<_>>()
        .join("\n");
    let source =
        format!("import {{ md }} from \"@use-crux/core\";\nconst large = md`\n{body}\n`;\n");

    let started = Instant::now();
    let response = analyze(request(&source));
    let elapsed = started.elapsed();

    assert_eq!(response.status, PromptTextAnalysisStatus::Truncated);
    assert!(response.templates.is_empty());
    assert!(
        elapsed <= Duration::from_secs(10),
        "132 KiB CommonMark projection took {elapsed:?}; release budget is 10s"
    );
}
