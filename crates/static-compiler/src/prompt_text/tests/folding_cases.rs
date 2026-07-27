use crux_indexer_protocol::prompt_text::{
    PromptTextAnalysisStatus, PromptTextBlock, PromptTextNodeRef,
};

use super::{analyze, request, support::text_at};

#[test]
fn nested_headings_retain_their_direct_block_parents() {
    let source = concat!(
        "const value = md`> # Quoted\n",
        "> body\n",
        "\n",
        "- # Listed\n",
        "  body\n",
        "`;"
    );
    let response = analyze(request(source));

    assert_eq!(response.status, PromptTextAnalysisStatus::Complete);
    let template = &response.templates[0];
    let heading_parent = |label: &str| {
        let heading = template
            .blocks
            .iter()
            .find_map(|block| match block {
                PromptTextBlock::Heading {
                    index, text_range, ..
                } if text_at(source, text_range) == label => Some(*index),
                _ => None,
            })
            .expect("fixture heading");
        let parent = template
            .nesting
            .iter()
            .find_map(|edge| match (&edge.parent, &edge.child) {
                (
                    PromptTextNodeRef::Block { index: parent },
                    PromptTextNodeRef::Block { index: child },
                ) if *child == heading => Some(*parent),
                _ => None,
            })
            .expect("heading block parent");
        &template.blocks[parent as usize]
    };

    assert!(matches!(
        heading_parent("Quoted"),
        PromptTextBlock::Blockquote { .. }
    ));
    assert!(matches!(
        heading_parent("Listed"),
        PromptTextBlock::ListItem { .. }
    ));
}
