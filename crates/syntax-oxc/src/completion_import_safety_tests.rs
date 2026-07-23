use crux_indexer_protocol::completion::{
    CompletionCandidate, CompletionPosition, CompletionQueryRequest,
};

use crate::completion::complete;

#[test]
fn completes_a_unique_visible_nested_same_file_binding() {
    let source = "import { agent } from '@use-crux/core/agent'\nfunction configure() {\n  const writer = prompt({ id: 'writer' })\n  return agent({ prompt: wr })\n}";
    let response = query_at(
        source,
        "wr",
        vec![candidate("writer", "/workspace/src/agent.ts")],
    );

    assert_eq!(response.items.len(), 1);
    assert_eq!(response.items[0].insert_text, "writer");
    assert!(response.items[0].additional_text_edits.is_empty());
}

#[test]
fn omits_candidates_that_cannot_leave_a_safe_binding() {
    let cases = [
        (
            "cross-file binding collision",
            "import { agent } from '@use-crux/core/agent'\nconst writer = 1\nconst support = agent({ prompt: wr",
            "wr",
            candidate("writer", "/workspace/src/prompts.ts"),
        ),
        (
            "same-file temporal dead zone",
            "import { agent } from '@use-crux/core/agent'\nconst support = agent({ prompt: wr })\nconst writer = prompt({})",
            "wr",
            candidate("writer", "/workspace/src/agent.ts"),
        ),
        (
            "same-file lexical shadow",
            "import { agent } from '@use-crux/core/agent'\nconst writer = prompt({})\nfunction use() {\n  const writer = 1\n  return agent({ prompt: wr })\n}",
            "wr",
            candidate("writer", "/workspace/src/agent.ts"),
        ),
        (
            "unsafe split import region",
            "const before = true\nimport { agent } from '@use-crux/core/agent'\nconst support = agent({ prompt: wr",
            "wr",
            candidate("writer", "/workspace/src/prompts.ts"),
        ),
        (
            "default-only export",
            "import { agent } from '@use-crux/core/agent'\nconst support = agent({ prompt: de",
            "de",
            candidate("default", "/workspace/src/prompts.ts"),
        ),
        (
            "missing named export",
            "import { agent } from '@use-crux/core/agent'\nconst support = agent({ prompt: wr",
            "wr",
            candidate("", "/workspace/src/prompts.ts"),
        ),
        (
            "shadowed existing alias",
            "import { agent } from '@use-crux/core/agent'\nimport { writer as authoredWriter } from './prompts'\nfunction use() {\n  const authoredWriter = 1\n  return agent({ prompt: auth })\n}",
            "auth",
            candidate("writer", "/workspace/src/prompts.ts"),
        ),
        (
            "trailing line comment in named import",
            "import { agent } from '@use-crux/core/agent'\nimport { helper // keep\n} from './prompts'\nconst support = agent({ prompt: wr",
            "wr",
            candidate("writer", "/workspace/src/prompts.ts"),
        ),
        (
            "line comment in empty named import",
            "import { agent } from '@use-crux/core/agent'\nimport { // keep\n} from './prompts'\nconst support = agent({ prompt: wr",
            "wr",
            candidate("writer", "/workspace/src/prompts.ts"),
        ),
        (
            "trailing block comment in named import",
            "import { agent } from '@use-crux/core/agent'\nimport { helper /* keep */ } from './prompts'\nconst support = agent({ prompt: wr",
            "wr",
            candidate("writer", "/workspace/src/prompts.ts"),
        ),
    ];

    for (name, source, marker, candidate) in cases {
        let response = query_at(source, marker, vec![candidate]);
        assert!(response.items.is_empty(), "{name}: {response:#?}");
    }
}

#[test]
fn keeps_incompatible_import_declarations_untouched() {
    let cases = [
        (
            "type-only",
            "import { agent } from '@use-crux/core/agent'\nimport type { WriterShape } from './prompts'\nconst support = agent({ prompt: wr",
        ),
        (
            "default-only",
            "import { agent } from '@use-crux/core/agent'\nimport promptModule from './prompts'\nconst support = agent({ prompt: wr",
        ),
        (
            "namespace",
            "import { agent } from '@use-crux/core/agent'\nimport * as promptModule from './prompts'\nconst support = agent({ prompt: wr",
        ),
    ];

    for (name, source) in cases {
        let response = query_at(
            source,
            "wr",
            vec![candidate("writer", "/workspace/src/prompts.ts")],
        );
        let item = response
            .items
            .first()
            .unwrap_or_else(|| panic!("{name}: no item"));
        assert_eq!(item.additional_text_edits.len(), 1, "{name}");
        assert_eq!(
            item.additional_text_edits[0].new_text, "import { writer } from './prompts'\n",
            "{name}"
        );
    }
}

#[test]
fn merges_empty_and_trailing_comma_named_imports_safely() {
    let cases = [
        ("import {} from './prompts'", " writer "),
        ("import { helper, } from './prompts'", " writer, "),
    ];
    for (import, expected_edit) in cases {
        let source = format!(
            "import {{ agent }} from '@use-crux/core/agent'\n{import}\nconst support = agent({{ prompt: wr"
        );
        let response = query_at(
            &source,
            "wr",
            vec![candidate("writer", "/workspace/src/prompts.ts")],
        );
        assert_eq!(
            response.items[0].additional_text_edits[0].new_text, expected_edit,
            "{import}"
        );
    }
}

#[test]
fn preserves_double_quote_and_semicolon_style_for_a_new_import() {
    let source =
        "import { agent } from \"@use-crux/core/agent\";\n\nconst support = agent({ prompt: wr";
    let response = query_at(
        source,
        "wr",
        vec![candidate("writer", "/workspace/src/prompts/writer.ts")],
    );
    assert_eq!(
        response.items[0].additional_text_edits[0].new_text,
        "import { writer } from \"./prompts/writer\";\n"
    );
}

#[test]
fn omits_an_ambiguous_merge_across_duplicate_compatible_imports() {
    let source = "import { agent } from '@use-crux/core/agent'\nimport { first } from './prompts'\nimport { second } from './prompts'\nconst support = agent({ prompt: wr";
    let response = query_at(
        source,
        "wr",
        vec![candidate("writer", "/workspace/src/prompts.ts")],
    );
    assert!(response.items.is_empty());
}

fn query_at(
    source: &str,
    marker: &str,
    candidates: Vec<CompletionCandidate>,
) -> crux_indexer_protocol::completion::CompletionQueryResponse {
    complete(CompletionQueryRequest {
        file: "/workspace/src/agent.ts".to_string(),
        language_id: "typescript".to_string(),
        source: source.to_string(),
        position: position_after_last(source, marker),
        candidates,
        limit: 100,
    })
}

fn position_after_last(source: &str, marker: &str) -> CompletionPosition {
    let offset = source.rfind(marker).unwrap() + marker.len();
    let before = &source[..offset];
    let line = before.bytes().filter(|byte| *byte == b'\n').count();
    let line_start = before.rfind('\n').map_or(0, |index| index + 1);
    CompletionPosition {
        line: line as u32,
        character: before[line_start..].encode_utf16().count() as u32,
    }
}

fn candidate(binding: &str, file: &str) -> CompletionCandidate {
    CompletionCandidate {
        id: format!("prompt:{binding}"),
        kind: "prompt".to_string(),
        name: binding.to_string(),
        binding: binding.to_string(),
        file: file.to_string(),
        line: 1,
        character: 1,
        description: None,
    }
}
