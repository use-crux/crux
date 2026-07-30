use crux_indexer_protocol::prompt_text::{PromptTextAnalysisStatus, PromptTextLink};

use super::{analyze, request, support::text_at};

#[test]
fn literal_links_preserve_visible_ranges_and_decoded_destinations() {
    let source = concat!(
        r#"const value = md`[g📘\\]uide](./a\\(b\\).md "Docs")"#,
        "\r\n",
        "<https://example.com/a?x=1>",
        "\r\n",
        "[reference][guide]",
        "\r\n",
        "[guide]: ./reference.md",
        "`;\n",
    );

    let response = analyze(request(source));

    assert_eq!(response.status, PromptTextAnalysisStatus::Complete);
    let template = &response.templates[0];
    assert_eq!(template.status, PromptTextAnalysisStatus::Complete);
    assert_eq!(template.links.len(), 2);
    match &template.links[0] {
        PromptTextLink::Inline {
            text_range,
            destination_range,
            destination,
            title,
            ..
        } => {
            assert_eq!(text_at(source, text_range), r#"g📘\\]uide"#);
            assert_eq!(text_at(source, destination_range), r#"./a\\(b\\).md"#);
            assert_eq!(destination, "./a(b).md");
            assert_eq!(title.as_deref(), Some("Docs"));
        }
        link => panic!("first link should be inline, got {link:?}"),
    }
    match &template.links[1] {
        PromptTextLink::Autolink {
            text_range,
            destination,
            ..
        } => {
            assert_eq!(text_at(source, text_range), "https://example.com/a?x=1");
            assert_eq!(destination, "https://example.com/a?x=1");
        }
        link => panic!("second link should be an autolink, got {link:?}"),
    }
    assert!(
        template
            .links
            .iter()
            .all(|link| !matches!(link, PromptTextLink::Inline { destination, .. } if destination == "./reference.md")),
        "reference-style links must stay closed in V1",
    );
}

#[test]
fn pointy_link_destinations_skip_escaped_closing_delimiters() {
    let source = r#"const value = md`[pointy](<./a\\>b.md>)`;"#;

    let response = analyze(request(source));

    let link = response.templates[0]
        .links
        .first()
        .expect("pointy destination should be parser-confirmed");
    assert!(matches!(
        link,
        PromptTextLink::Inline {
            destination,
            destination_range,
            ..
        } if destination == "./a>b.md"
            && text_at(source, destination_range) == r#"./a\\>b.md"#
    ));
}

#[test]
fn interpolation_barriers_cannot_complete_link_destinations() {
    let source = concat!(
        "const value = md`[dynamic](",
        "${target}",
        ") [split](./guide",
        "${suffix}",
        ") [safe](./safe.md)`;\n",
    );

    let response = analyze(request(source));

    assert_eq!(response.status, PromptTextAnalysisStatus::Complete);
    let template = &response.templates[0];
    assert_eq!(template.links.len(), 1);
    assert!(matches!(
        &template.links[0],
        PromptTextLink::Inline {
            destination,
            text_range,
            ..
        } if destination == "./safe.md" && text_at(source, text_range) == "safe"
    ));
}
