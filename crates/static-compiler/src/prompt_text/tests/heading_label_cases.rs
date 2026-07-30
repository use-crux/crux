use crux_indexer_protocol::prompt_text::{
    PromptTextAnalysisStatus, PromptTextBlock, PromptTextPosition, PromptTextPreviewSegment,
    PromptTextPreviewStatus,
};

use super::{analyze, request};

#[test]
fn heading_labels_come_from_normalized_commonmark_events() {
    let source = concat!(
        "const decoded = md`# A &amp; \\\\*star\\\\* *em***strong**`;\n",
        "const code = md`# Before \\` a   b \\` after`;\n",
        "const links = md`# [guide](https://example.com) ![cat](cat.png) <https://example.org>`;\n",
        "const html = md`# A<i>B</i>C`;\n",
        "const breaks = md`First\nSecond  \nThird\n=====`;\n",
        "const whitespace = md`# A\u{00a0}\u{2003}B`;\n",
        "const unicode = md`# Cafe\u{0301} — 😀`;\n",
        "const malformed = md`# **open [bad`;\n",
        "const empty = md`###`;\n",
    );

    let response = analyze(request(source));

    assert_eq!(response.status, PromptTextAnalysisStatus::Complete);
    assert_eq!(
        response
            .templates
            .iter()
            .flat_map(|template| &template.blocks)
            .filter_map(|block| match block {
                PromptTextBlock::Heading { label, .. } => Some(label.as_str()),
                _ => None,
            })
            .collect::<Vec<_>>(),
        [
            "A & *star* emstrong",
            "Before a b after",
            "guide cat https://example.org",
            "ABC",
            "First Second Third",
            "A B",
            "Cafe\u{0301} — 😀",
            "**open [bad",
            "Heading 3",
        ]
    );
    assert!(response.templates.iter().all(|template| {
        template.preview.status == PromptTextPreviewStatus::Complete
            && template
                .preview
                .segments
                .iter()
                .map(|segment| match segment {
                    PromptTextPreviewSegment::AuthoredLiteral { text, .. }
                    | PromptTextPreviewSegment::KnownValue { text, .. }
                    | PromptTextPreviewSegment::Fragment { text, .. }
                    | PromptTextPreviewSegment::Placeholder { text, .. } => text.as_str(),
                })
                .collect::<String>()
                == template.preview.text
    }));
}

#[test]
fn heading_labels_preserve_crlf_utf16_ranges() {
    let response = analyze(request("const value = md`# Hé\r\n## 次\r\n`;"));
    let headings = response.templates[0]
        .blocks
        .iter()
        .filter_map(|block| match block {
            PromptTextBlock::Heading {
                label, text_range, ..
            } => Some((label.as_str(), text_range)),
            _ => None,
        })
        .collect::<Vec<_>>();

    assert_eq!(headings.len(), 2);
    assert_eq!(headings[0].0, "Hé");
    assert_eq!(
        headings[0].1.start,
        PromptTextPosition {
            line: 0,
            character: 19,
        }
    );
    assert_eq!(
        headings[0].1.end,
        PromptTextPosition {
            line: 0,
            character: 21,
        }
    );
    assert_eq!(headings[1].0, "次");
    assert_eq!(
        headings[1].1.start,
        PromptTextPosition {
            line: 1,
            character: 3,
        }
    );
    assert_eq!(
        headings[1].1.end,
        PromptTextPosition {
            line: 1,
            character: 4,
        }
    );
}

#[test]
fn heading_labels_never_cross_interpolation_islands() {
    let response = analyze(request("const value = md`# left${name}# right`;"));

    let labels = response.templates[0]
        .blocks
        .iter()
        .filter_map(|block| match block {
            PromptTextBlock::Heading { label, .. } => Some(label.as_str()),
            _ => None,
        })
        .collect::<Vec<_>>();
    assert_eq!(labels, ["left", "right"]);
}
