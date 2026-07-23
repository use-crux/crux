use crux_indexer_protocol::completion::{
    CompletionCandidate, CompletionPosition, CompletionQueryRequest,
};

use crate::completion::complete;

#[test]
fn ranks_prefix_accessibility_locality_and_stable_identity_in_order() {
    let source =
        "const alpha = prompt({})\nconst writer = prompt({})\nconst support = agent({ prompt: wr";
    let candidates = vec![
        candidate(
            "prompt:alpha",
            "alpha",
            "alpha",
            "/workspace/src/agent.ts",
            1,
        ),
        candidate(
            "prompt:writer",
            "writer",
            "writer",
            "/workspace/src/agent.ts",
            2,
        ),
        candidate(
            "prompt:shared",
            "wren",
            "wren",
            "/workspace/src/shared.ts",
            1,
        ),
        candidate(
            "prompt:named",
            "writer preset",
            "authored",
            "/workspace/src/z.ts",
            1,
        ),
        candidate("prompt:parent", "wrong", "wrong", "/workspace/common.ts", 1),
    ];

    let first = query(source, candidates.clone());
    let second = query(source, candidates);
    assert_eq!(first, second);
    assert_eq!(
        first
            .items
            .iter()
            .map(|item| item.id.as_str())
            .collect::<Vec<_>>(),
        vec![
            "prompt:writer",
            "prompt:shared",
            "prompt:named",
            "prompt:parent",
            "prompt:alpha",
        ]
    );
}

#[test]
fn uses_source_position_kind_id_and_binding_as_total_tie_breaks() {
    let source = "const support = agent({ prompt: ";
    let candidates = vec![
        candidate("prompt:b", "same", "zeta", "/workspace/src/prompts.ts", 2),
        candidate("prompt:c", "same", "beta", "/workspace/src/prompts.ts", 1),
        candidate("prompt:a", "same", "alpha", "/workspace/src/prompts.ts", 1),
    ];
    let response = query(source, candidates);
    assert_eq!(
        response
            .items
            .iter()
            .map(|item| item.id.as_str())
            .collect::<Vec<_>>(),
        vec!["prompt:a", "prompt:c", "prompt:b"]
    );
}

#[test]
fn caps_prefix_ranked_results_and_marks_the_list_incomplete() {
    let declarations = (0..105)
        .map(|index| format!("const prompt{index:03} = prompt({{}})"))
        .collect::<Vec<_>>();
    let source = format!(
        "{}\nconst support = agent({{ prompt: pro",
        declarations.join("\n")
    );
    let candidates = (0..105)
        .map(|index| {
            candidate(
                &format!("prompt:{index:03}"),
                &format!("prompt{index:03}"),
                &format!("prompt{index:03}"),
                "/workspace/src/agent.ts",
                index + 1,
            )
        })
        .collect();

    let response = query(&source, candidates);
    assert!(response.is_incomplete);
    assert_eq!(response.items.len(), 100);
    assert_eq!(response.items[0].id, "prompt:000");
    assert_eq!(response.items[99].id, "prompt:099");
}

fn query(
    source: &str,
    candidates: Vec<CompletionCandidate>,
) -> crux_indexer_protocol::completion::CompletionQueryResponse {
    let source = format!("import {{ agent }} from '@use-crux/core/agent'\n{source}");
    complete(CompletionQueryRequest {
        file: "/workspace/src/agent.ts".to_string(),
        language_id: "typescript".to_string(),
        position: position_at_end(&source),
        source,
        candidates,
        limit: 100,
    })
}

fn position_at_end(source: &str) -> CompletionPosition {
    let line_start = source.rfind('\n').map_or(0, |index| index + 1);
    CompletionPosition {
        line: source.bytes().filter(|byte| *byte == b'\n').count() as u32,
        character: source[line_start..].encode_utf16().count() as u32,
    }
}

fn candidate(id: &str, name: &str, binding: &str, file: &str, line: u32) -> CompletionCandidate {
    CompletionCandidate {
        id: id.to_string(),
        kind: "prompt".to_string(),
        name: name.to_string(),
        binding: binding.to_string(),
        file: file.to_string(),
        line,
        character: 1,
        description: None,
    }
}
