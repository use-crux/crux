use crux_indexer_protocol::completion::{
    CompletionCandidate, CompletionPosition, CompletionQueryRequest, CompletionQueryResponse,
};

use crate::completion::complete;

#[test]
fn completes_identifier_array_elements_and_filters_incompatible_kinds() {
    let response = query(
        "
const brandContext = context({ id: 'brand' })
const writerPrompt = prompt({ id: 'writer', use: [br|] })
",
        vec![
            candidate("context:brand", "context", "brand", "brandContext"),
            candidate("tool:brand", "tool", "brand", "brandTool"),
        ],
    );

    assert_eq!(item_ids(&response), ["context:brand"]);
    assert_eq!(response.items[0].insert_text, "brandContext");
}

#[test]
fn completes_empty_incomplete_identifier_array_elements() {
    let response = query(
        "
const brandContext = context({ id: 'brand' })
const writerPrompt = prompt({ id: 'writer', use: [|",
        vec![candidate(
            "context:brand",
            "context",
            "brand",
            "brandContext",
        )],
    );

    assert_eq!(item_ids(&response), ["context:brand"]);
}

#[test]
fn tool_maps_use_shorthand_or_a_stable_quoted_key_and_exclude_duplicates() {
    let shorthand = query(
        "
const searchTool = tool({ name: 'searchTool' })
const writerPrompt = prompt({ id: 'writer', tools: { sea| } })
",
        vec![candidate(
            "tool:searchTool",
            "tool",
            "searchTool",
            "searchTool",
        )],
    );
    assert_eq!(shorthand.items[0].insert_text, "searchTool");

    let safe_explicit = query(
        "
const searchTool = tool({ name: 'search' })
const writerPrompt = prompt({ id: 'writer', tools: { sea| } })
",
        vec![candidate("tool:search", "tool", "search", "searchTool")],
    );
    assert_eq!(safe_explicit.items[0].insert_text, "search: searchTool");

    let explicit = query(
        "
const billingLookup = tool({ name: 'billing-lookup' })
const writerPrompt = prompt({ id: 'writer', tools: { bil| } })
",
        vec![candidate(
            "tool:billing-lookup",
            "tool",
            "billing-lookup",
            "billingLookup",
        )],
    );
    assert_eq!(
        explicit.items[0].insert_text,
        "'billing-lookup': billingLookup"
    );

    let duplicate = query(
        "
const billingLookup = tool({ name: 'billing-lookup' })
const writerPrompt = prompt({
  id: 'writer',
  tools: { \"billing-lookup\": billingLookup, bil| },
})
",
        vec![candidate(
            "tool:billing-lookup",
            "tool",
            "billing-lookup",
            "billingLookup",
        )],
    );
    assert!(duplicate.items.is_empty());
}

#[test]
fn static_handoffs_insert_only_the_existing_slot_value_and_exclude_self() {
    let candidates = vec![
        candidate("agent:writer", "agent", "writer", "writerAgent"),
        candidate("agent:reviewer", "agent", "reviewer", "reviewerAgent"),
    ];
    let array_value = query(
        "
const reviewerAgent = agent({ id: 'reviewer' })
const writerAgent = agent({ id: 'writer', handoffs: ['rev|'] })
",
        candidates.clone(),
    );
    assert_eq!(item_ids(&array_value), ["agent:reviewer"]);
    assert_eq!(array_value.items[0].insert_text, "reviewer");

    let object_value = query(
        "
const reviewerAgent = agent({ id: 'reviewer' })
const writerAgent = agent({
  id: 'writer',
  handoffs: [{ id: 'rev|' }],
})
",
        candidates,
    );
    assert_eq!(item_ids(&object_value), ["agent:reviewer"]);
    assert_eq!(object_value.items[0].insert_text, "reviewer");

    let implicit_id = query(
        "
const reviewerAgent = agent({ id: 'reviewer' })
const writerAgent = agent({ handoffs: ['wri|'] })
",
        vec![
            candidate("agent:writerAgent", "agent", "writerAgent", "writerAgent"),
            candidate("agent:reviewer", "agent", "reviewer", "reviewerAgent"),
        ],
    );
    assert_eq!(item_ids(&implicit_id), ["agent:reviewer"]);
}

#[test]
fn static_handoffs_quote_new_array_slots_without_rewriting_the_array() {
    let response = query(
        "
const reviewerAgent = agent({ id: 'reviewer' })
const writerAgent = agent({ id: 'writer', handoffs: [|] })
",
        vec![candidate(
            "agent:reviewer",
            "agent",
            "reviewer",
            "reviewerAgent",
        )],
    );

    assert_eq!(response.items[0].insert_text, "'reviewer'");
}

#[test]
fn completes_every_indexed_routing_target_shape() {
    let fixtures = [
        "router({ id: 'subject', routes: { main: wr| } })",
        "router({ id: 'subject', routes: { main: { model: wr| } } })",
        "split({ id: 'subject', routes: { main: { model: wr|, weight: 1 } } })",
        "retry(wr|, { id: 'subject' })",
        "cascade({ id: 'subject', tiers: [{ model: wr| }] })",
        "fallback([wr|], { id: 'subject' })",
        "fallback(wr|, { id: 'subject' })",
    ];

    for fixture in fixtures {
        let response = query(
            &format!(
                "
const writerPrompt = prompt({{ id: 'writer' }})
const subject = router({{ id: 'subject', routes: {{ default: writerPrompt }} }})
const routed = {fixture}
"
            ),
            vec![
                candidate("prompt:writer", "prompt", "writer", "writerPrompt"),
                candidate(
                    "routing.router:subject",
                    "routing.router",
                    "subject",
                    "subject",
                ),
                candidate("tool:wrong", "tool", "wrong", "wrongTool"),
            ],
        );
        assert_eq!(item_ids(&response), ["prompt:writer"], "{fixture}");
    }
}

#[test]
fn implicit_routing_owner_is_not_its_own_target() {
    let response = query(
        "
const writerPrompt = prompt({ id: 'writer' })
const subject = router({ routes: { main: sub| } })
",
        vec![
            candidate(
                "routing.router:subject",
                "routing.router",
                "subject",
                "subject",
            ),
            candidate("prompt:writer", "prompt", "writer", "writerPrompt"),
        ],
    );

    assert_eq!(item_ids(&response), ["prompt:writer"]);
}

#[test]
fn scalar_routing_properties_accept_only_indexed_routing_owners() {
    let response = query(
        "
const qualityRouter = router({ id: 'quality', routes: {} })
const writerPrompt = prompt({ id: 'writer' })
const writerAgent = agent({ id: 'agent', model: qua| })
",
        vec![
            candidate(
                "routing.router:quality",
                "routing.router",
                "quality",
                "qualityRouter",
            ),
            candidate("prompt:writer", "prompt", "writer", "writerPrompt"),
        ],
    );

    assert_eq!(item_ids(&response), ["routing.router:quality"]);
}

fn query(marked_source: &str, candidates: Vec<CompletionCandidate>) -> CompletionQueryResponse {
    let marked_source = format!(
        "import {{ agent }} from '@use-crux/core/agent'\n\
         import {{ context, prompt }} from '@use-crux/core'\n\
         import {{ cascade, fallback, retry, router, split }} from '@use-crux/core/routing'\n\
         {marked_source}"
    );
    let marker = marked_source.find('|').expect("fixture marker");
    let source = marked_source.replacen('|', "", 1);
    complete(CompletionQueryRequest {
        file: "src/fixture.ts".to_string(),
        language_id: "typescript".to_string(),
        position: position_for_offset(&source, marker),
        source,
        candidates,
        limit: 100,
    })
}

fn position_for_offset(source: &str, offset: usize) -> CompletionPosition {
    let line_start = source[..offset].rfind('\n').map_or(0, |index| index + 1);
    CompletionPosition {
        line: source[..offset]
            .bytes()
            .filter(|byte| *byte == b'\n')
            .count() as u32,
        character: source[line_start..offset].encode_utf16().count() as u32,
    }
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

fn item_ids(response: &CompletionQueryResponse) -> Vec<&str> {
    response.items.iter().map(|item| item.id.as_str()).collect()
}
