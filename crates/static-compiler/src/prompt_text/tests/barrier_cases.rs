use crux_indexer_protocol::prompt_text::{
    PromptTextAnalysisStatus, PromptTextBlock, PromptTextLink, PromptTextRange, PromptTextSpan,
};

use super::{analyze, request, support::text_at};

#[test]
fn maps_crlf_unicode_roles_without_crossing_a_nested_interpolation() {
    let source = concat!(
        "const name = 'Ada'; const value = md`\r\n",
        "  # Héllo **team**\r\n",
        "  > 👋 *Welcome*${/* opaque } */ ({ nested: `inner ${name}` })}\r\n",
        "  - Read [guide](https://example.com) and \\`code\\`\r\n",
        "`;"
    );
    let response = analyze(request(source));

    assert_eq!(response.status, PromptTextAnalysisStatus::Complete);
    let template = &response.templates[0];
    assert_eq!(template.status, PromptTextAnalysisStatus::Complete);
    assert_eq!(template.interpolation_barriers.len(), 1);
    assert!(
        template
            .blocks
            .iter()
            .any(|block| matches!(block, PromptTextBlock::List { .. }))
    );
    assert_eq!(
        role_text(source, template),
        [
            ("heading", String::from("Héllo **team")),
            ("strong", String::from("team")),
            ("blockquote", String::from(">")),
            ("emphasis", String::from("Welcome")),
            ("list", String::from("-")),
            ("link", String::from("guide")),
            ("code", String::from("code")),
        ],
    );

    let barrier = &template.interpolation_barriers[0];
    for range in structure_ranges(template) {
        assert!(!intersects(range, &barrier.range));
        assert!(!intersects(range, &barrier.expression_range));
        assert!(!intersects(range, &template.tag_range));
        assert!(
            template
                .literal_islands
                .iter()
                .any(|island| contains(&island.range, range))
        );
    }
}

fn role_text(
    source: &str,
    template: &crux_indexer_protocol::prompt_text::PromptTextTemplate,
) -> Vec<(&'static str, String)> {
    let mut roles = Vec::new();
    for block in &template.blocks {
        match block {
            PromptTextBlock::Heading { text_range, .. } => {
                roles.push(("heading", text_at(source, text_range)));
            }
            PromptTextBlock::Blockquote { marker_ranges, .. } => {
                roles.extend(
                    marker_ranges
                        .iter()
                        .map(|range| ("blockquote", text_at(source, range))),
                );
            }
            PromptTextBlock::ListItem { marker_range, .. } => {
                roles.push(("list", text_at(source, marker_range)));
            }
            _ => {}
        }
    }
    for span in &template.spans {
        match span {
            PromptTextSpan::Emphasis { text_range, .. } => {
                roles.push(("emphasis", text_at(source, text_range)));
            }
            PromptTextSpan::Strong { text_range, .. } => {
                roles.push(("strong", text_at(source, text_range)));
            }
            PromptTextSpan::InlineCode { text_range, .. } => {
                roles.push(("code", text_at(source, text_range)));
            }
            _ => {}
        }
    }
    roles.extend(template.links.iter().map(|link| match link {
        PromptTextLink::Inline { text_range, .. } | PromptTextLink::Autolink { text_range, .. } => {
            ("link", text_at(source, text_range))
        }
    }));
    roles.sort_by_key(|(_, text)| match text.as_str() {
        "Héllo **team" => 0,
        "team" => 1,
        ">" => 2,
        "Welcome" => 3,
        "-" => 4,
        "guide" => 5,
        "code" => 6,
        _ => 7,
    });
    roles
}

fn structure_ranges(
    template: &crux_indexer_protocol::prompt_text::PromptTextTemplate,
) -> Vec<&PromptTextRange> {
    let mut ranges = Vec::new();
    for block in &template.blocks {
        match block {
            PromptTextBlock::Heading {
                range, text_range, ..
            } => ranges.extend([range, text_range]),
            PromptTextBlock::Blockquote {
                range,
                marker_ranges,
                ..
            } => {
                ranges.push(range);
                ranges.extend(marker_ranges);
            }
            PromptTextBlock::ListItem {
                range,
                marker_range,
                ..
            } => ranges.extend([range, marker_range]),
            PromptTextBlock::Paragraph { range, .. }
            | PromptTextBlock::List { range, .. }
            | PromptTextBlock::ThematicBreak { range, .. }
            | PromptTextBlock::Html { range, .. } => ranges.push(range),
            PromptTextBlock::CodeBlock {
                range,
                content_range,
                ..
            } => ranges.extend([range, content_range]),
        }
    }
    for span in &template.spans {
        match span {
            PromptTextSpan::Emphasis {
                range, text_range, ..
            }
            | PromptTextSpan::Strong {
                range, text_range, ..
            }
            | PromptTextSpan::InlineCode {
                range, text_range, ..
            } => ranges.extend([range, text_range]),
            PromptTextSpan::Html { range, .. }
            | PromptTextSpan::SoftBreak { range, .. }
            | PromptTextSpan::HardBreak { range, .. } => ranges.push(range),
        }
    }
    for link in &template.links {
        match link {
            PromptTextLink::Inline {
                range,
                text_range,
                destination_range,
                ..
            } => ranges.extend([range, text_range, destination_range]),
            PromptTextLink::Autolink {
                range, text_range, ..
            } => ranges.extend([range, text_range]),
        }
    }
    ranges
}

fn contains(outer: &PromptTextRange, inner: &PromptTextRange) -> bool {
    position(outer.start) <= position(inner.start) && position(inner.end) <= position(outer.end)
}

fn intersects(left: &PromptTextRange, right: &PromptTextRange) -> bool {
    position(left.start) < position(right.end) && position(right.start) < position(left.end)
}

fn position(value: crux_indexer_protocol::prompt_text::PromptTextPosition) -> (u32, u32) {
    (value.line, value.character)
}
