use crux_indexer_protocol::completion::{
    CompletionCandidate, CompletionPosition, CompletionQueryRequest,
};

use crate::completion::complete;

#[test]
fn classifies_the_remaining_declarative_manifest_rows() {
    let fixtures = [
        (
            "
const qualityRouter = router({ id: 'quality', routes: {} })
const support = agent({ id: 'support', languageModel: qua| })
",
            candidate(
                "routing.router:quality",
                "routing.router",
                "quality",
                "qualityRouter",
            ),
            "qualityRouter",
        ),
        (
            "
const searchTool = tool({ name: 'search' })
const support = agent({ id: 'support', tools: { sea| } })
",
            candidate("tool:search", "tool", "search", "searchTool"),
            "search: searchTool",
        ),
        (
            "
const brandContext = context({ id: 'brand' })
const sharedContext = context({ id: 'shared', use: [bra|] })
",
            candidate("context:brand", "context", "brand", "brandContext"),
            "brandContext",
        ),
        (
            "
const searchTool = tool({ name: 'search' })
const sharedContext = context({ id: 'shared', tools: { sea| } })
",
            candidate("tool:search", "tool", "search", "searchTool"),
            "search: searchTool",
        ),
    ];

    for (source, candidate, expected) in fixtures {
        let response = query(source, candidate);
        assert_eq!(response.items.len(), 1, "{source}");
        assert_eq!(response.items[0].insert_text, expected, "{source}");
    }
}

fn query(
    marked_source: &str,
    candidate: CompletionCandidate,
) -> crux_indexer_protocol::completion::CompletionQueryResponse {
    let marked_source = format!(
        "import {{ agent }} from '@use-crux/core/agent'\n\
         import {{ context }} from '@use-crux/core'\n{marked_source}"
    );
    let marker = marked_source.find('|').expect("fixture marker");
    let source = marked_source.replacen('|', "", 1);
    let line_start = source[..marker].rfind('\n').map_or(0, |index| index + 1);
    complete(CompletionQueryRequest {
        file: "src/fixture.ts".to_string(),
        language_id: "typescript".to_string(),
        position: CompletionPosition {
            line: source[..marker]
                .bytes()
                .filter(|byte| *byte == b'\n')
                .count() as u32,
            character: source[line_start..marker].encode_utf16().count() as u32,
        },
        source,
        candidates: vec![candidate],
        limit: 100,
    })
}

fn candidate(id: &str, kind: &str, name: &str, binding: &str) -> CompletionCandidate {
    CompletionCandidate {
        id: id.to_string(),
        kind: kind.to_string(),
        name: name.to_string(),
        binding: binding.to_string(),
        file: "src/fixture.ts".to_string(),
        line: 1,
        character: 0,
        description: None,
    }
}
