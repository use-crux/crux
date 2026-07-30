use crux_indexer_protocol::prompt_text::{
    PromptTextAnalysisStatus, PromptTextBlock, PromptTextLink, PromptTextNodeRef, PromptTextSpan,
};

use super::{analyze, request, support::text_at};

#[test]
fn classifies_commonmark_records_with_exact_authored_ranges_and_nesting() {
    let source = concat!(
        "const value = md`# Title\n",
        "\n",
        "> quote\n",
        "\n",
        "1. first\n",
        "2. second\n",
        "- bullet\n",
        "\n",
        "*em* **strong** [guide](https://x.test \"Docs\") <https://y.test> \\`code\\`\n",
        "\n",
        "\\`\\`\\`ts\n",
        "let x = 1\n",
        "\\`\\`\\`\n",
        "\n",
        "---\n",
        "\n",
        "before <b>x</b>\n",
        "`;"
    );

    let response = analyze(request(source));

    assert_eq!(response.status, PromptTextAnalysisStatus::Complete);
    let template = &response.templates[0];
    assert_eq!(template.status, PromptTextAnalysisStatus::Complete);

    let headings = template
        .blocks
        .iter()
        .filter_map(|block| match block {
            PromptTextBlock::Heading {
                range, text_range, ..
            } => Some((text_at(source, range), text_at(source, text_range))),
            _ => None,
        })
        .collect::<Vec<_>>();
    assert_eq!(
        headings,
        [(String::from("# Title\n"), String::from("Title"))]
    );

    let quote_markers = template
        .blocks
        .iter()
        .filter_map(|block| match block {
            PromptTextBlock::Blockquote { marker_ranges, .. } => Some(
                marker_ranges
                    .iter()
                    .map(|range| text_at(source, range))
                    .collect::<Vec<_>>(),
            ),
            _ => None,
        })
        .collect::<Vec<_>>();
    assert_eq!(quote_markers, [vec![String::from(">")]]);

    let list_markers = template
        .blocks
        .iter()
        .filter_map(|block| match block {
            PromptTextBlock::ListItem { marker_range, .. } => Some(text_at(source, marker_range)),
            _ => None,
        })
        .collect::<Vec<_>>();
    assert_eq!(list_markers, ["1.", "2.", "-"]);

    let text_spans = template
        .spans
        .iter()
        .filter_map(|span| match span {
            PromptTextSpan::Emphasis { text_range, .. } => {
                Some(("emphasis", text_at(source, text_range)))
            }
            PromptTextSpan::Strong { text_range, .. } => {
                Some(("strong", text_at(source, text_range)))
            }
            PromptTextSpan::InlineCode { text_range, .. } => {
                Some(("code", text_at(source, text_range)))
            }
            _ => None,
        })
        .collect::<Vec<_>>();
    assert_eq!(
        text_spans,
        [
            ("emphasis", String::from("em")),
            ("strong", String::from("strong")),
            ("code", String::from("code"))
        ]
    );

    let links = template
        .links
        .iter()
        .map(|link| match link {
            PromptTextLink::Inline {
                text_range,
                destination_range,
                destination,
                title,
                ..
            } => (
                "inline",
                text_at(source, text_range),
                Some(text_at(source, destination_range)),
                destination.clone(),
                title.clone(),
            ),
            PromptTextLink::Autolink {
                text_range,
                destination,
                ..
            } => (
                "autolink",
                text_at(source, text_range),
                None,
                destination.clone(),
                None,
            ),
        })
        .collect::<Vec<_>>();
    assert_eq!(
        links,
        [
            (
                "inline",
                String::from("guide"),
                Some(String::from("https://x.test")),
                String::from("https://x.test"),
                Some(String::from("Docs")),
            ),
            (
                "autolink",
                String::from("https://y.test"),
                None,
                String::from("https://y.test"),
                None,
            ),
        ]
    );

    assert!(template.blocks.iter().any(|block| matches!(
        block,
        PromptTextBlock::CodeBlock {
            fenced: true,
            info: Some(info),
            content_range,
            ..
        } if info == "ts" && text_at(source, content_range) == "let x = 1\n"
    )));
    assert!(
        template
            .blocks
            .iter()
            .any(|block| matches!(block, PromptTextBlock::ThematicBreak { .. }))
    );
    assert_eq!(
        template
            .spans
            .iter()
            .filter(|span| matches!(span, PromptTextSpan::Html { .. }))
            .count(),
        2
    );

    for edge in &template.nesting {
        assert!(node_exists(template, &edge.parent));
        assert!(node_exists(template, &edge.child));
    }
    let list_children = template
        .nesting
        .iter()
        .filter(|edge| {
            matches!(edge.parent, PromptTextNodeRef::Block { index } if matches!(
                template.blocks[index as usize],
                PromptTextBlock::List { .. }
            ))
        })
        .map(|edge| edge.ordinal)
        .collect::<Vec<_>>();
    assert_eq!(list_children, [0, 1, 0]);
}

#[test]
fn interpolation_barriers_prevent_delimiters_from_forming_structure() {
    let response = analyze(request("const value = md`*left${name}right*`;"));

    assert_eq!(response.status, PromptTextAnalysisStatus::Complete);
    assert_eq!(response.templates[0].interpolation_barriers.len(), 1);
    assert!(response.templates[0].spans.is_empty());
}

#[test]
fn empty_and_malformed_commonmark_stays_complete_and_bounded() {
    let response = analyze(request(concat!(
        "const empty = md`#`;\n",
        "const malformed = md`**open [label](<bad`;\n",
        "const code = md`\\`\\`\\`\n\\`\\`\\``;"
    )));

    assert_eq!(response.status, PromptTextAnalysisStatus::Complete);
    assert_eq!(response.templates.len(), 3);
    assert!(
        response
            .templates
            .iter()
            .all(|template| template.status == PromptTextAnalysisStatus::Complete)
    );
    assert!(matches!(
        response.templates[0].blocks.first(),
        Some(PromptTextBlock::Heading { .. })
    ));
    assert!(matches!(
        response.templates[2].blocks.first(),
        Some(PromptTextBlock::CodeBlock { .. })
    ));
}

#[test]
fn inline_link_label_allows_a_closing_bracket_inside_code() {
    let source = "const value = md`[a \\`x]y\\` z](https://example.com)`;";

    let response = analyze(request(source));

    assert_eq!(response.status, PromptTextAnalysisStatus::Complete);
    let template = &response.templates[0];
    assert_eq!(template.links.len(), 1);
    assert!(matches!(
        &template.links[0],
        PromptTextLink::Inline {
            text_range,
            destination_range,
            destination,
            ..
        } if text_at(source, text_range) == "a \\`x]y\\` z"
            && text_at(source, destination_range) == "https://example.com"
            && destination == "https://example.com"
    ));
    assert!(template.spans.iter().any(|span| matches!(
        span,
        PromptTextSpan::InlineCode { text_range, .. }
            if text_at(source, text_range) == "x]y"
    )));
}

fn node_exists(
    template: &crux_indexer_protocol::prompt_text::PromptTextTemplate,
    node: &PromptTextNodeRef,
) -> bool {
    match node {
        PromptTextNodeRef::Block { index } => (*index as usize) < template.blocks.len(),
        PromptTextNodeRef::Span { index } => (*index as usize) < template.spans.len(),
        PromptTextNodeRef::Link { index } => (*index as usize) < template.links.len(),
    }
}
