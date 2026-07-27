use crux_indexer_protocol::prompt_text::{
    PromptTextEvidenceProof, PromptTextFragment, PromptTextFragmentJoin,
    PromptTextInterpolationJoinKey, PromptTextPreviewSegment,
};

use super::super::{analyze, range, request};

#[test]
fn preview_renders_repeated_acyclic_document_fragments_independently() {
    let source = "const item = md`one`; const root = md`${item}|${item}`;";
    let response = analyze(request(source));
    let preview = &response.templates[1].preview;

    assert_eq!(preview.text, "one|one");
    assert_eq!(fragment_segment_count(&preview.segments, "document:0"), 2);
}

#[test]
fn preview_renders_repeated_semantic_joins_independently() {
    let source = "const root = md`${shared}|${shared}`;";
    let fragment_source = "md`Shared`";
    let mut query = request(source);
    query.fragments.push(PromptTextFragment {
        id: "shared-ref".into(),
        symbol: "shared".into(),
        file: "/repo/src/shared.ts".into(),
        source_hash: "shared-hash".into(),
        range: range(2, 3, 2, 3 + fragment_source.len() as u32),
        snippet: fragment_source.into(),
    });
    query.fragment_joins = (0..2)
        .map(|interpolation| {
            semantic_join(
                &query.file,
                &query.revision.source_hash,
                source,
                "shared",
                interpolation,
            )
        })
        .collect();

    let response = analyze(query);
    let preview = &response.templates[0].preview;
    assert_eq!(preview.text, "Shared|Shared");
    assert_eq!(fragment_segment_count(&preview.segments, "shared-ref"), 2);
}

fn semantic_join(
    file: &str,
    source_hash: &str,
    source: &str,
    expression: &str,
    interpolation: u32,
) -> PromptTextFragmentJoin {
    let template_start = source.find("md`").expect("template");
    let template_end = source.rfind('`').expect("template end") + 1;
    let expression_start = source
        .match_indices(expression)
        .nth(interpolation as usize)
        .map(|(index, _)| index)
        .expect("expression");
    PromptTextFragmentJoin {
        key: PromptTextInterpolationJoinKey {
            file: file.into(),
            source_hash: source_hash.into(),
            template_range: range(0, template_start as u32, 0, template_end as u32),
            interpolation,
            expression_range: range(
                0,
                expression_start as u32,
                0,
                (expression_start + expression.len()) as u32,
            ),
        },
        fragment_id: "shared-ref".into(),
        proof: PromptTextEvidenceProof::SemanticExact,
    }
}

fn fragment_segment_count(segments: &[PromptTextPreviewSegment], id: &str) -> usize {
    segments
        .iter()
        .filter(|segment| {
            matches!(
                segment,
                PromptTextPreviewSegment::Fragment { fragment_id, .. }
                    if fragment_id == id
            )
        })
        .count()
}
