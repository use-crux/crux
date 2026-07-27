use crux_indexer_syntax_oxc::prompt_text::{
    ProjectedInterpolation, ProjectedSequenceItem, ProjectedValue,
};

use super::{
    FragmentOutcome, FragmentReference, Placement, RenderFlags, json, segments::PreviewSegments,
};

pub(super) fn render(
    segments: &mut PreviewSegments,
    interpolation: &ProjectedInterpolation,
    placement: Placement,
    fragment: &mut impl FnMut(FragmentReference) -> FragmentOutcome,
) -> RenderFlags {
    match &interpolation.value {
        ProjectedValue::Scalar(text) => {
            render_known(segments, text, interpolation.index, Vec::new(), placement);
            RenderFlags::default()
        }
        ProjectedValue::Omitted => RenderFlags::default(),
        ProjectedValue::Sequence(items) => match placement {
            Placement::Inline => {
                segments.placeholder(interpolation.index);
                RenderFlags::default()
            }
            Placement::Block {
                indent,
                indent_range,
            } => render_sequence(
                segments,
                interpolation.index,
                items,
                &indent,
                indent_range,
                fragment,
            ),
        },
        ProjectedValue::Json(value) => {
            render_known(
                segments,
                &json::stringify(value),
                interpolation.index,
                Vec::new(),
                placement,
            );
            RenderFlags::default()
        }
        ProjectedValue::Fragment { candidate_id } => render_fragment(
            segments,
            interpolation.index,
            Vec::new(),
            &placement,
            FragmentReference::Document(*candidate_id),
            fragment,
        ),
        ProjectedValue::SemanticFragment { fragment: target } => render_fragment(
            segments,
            interpolation.index,
            Vec::new(),
            &placement,
            FragmentReference::Semantic(*target),
            fragment,
        ),
        ProjectedValue::Unknown => {
            segments.placeholder(interpolation.index);
            RenderFlags::default()
        }
    }
}

fn render_fragment(
    segments: &mut PreviewSegments,
    interpolation: u32,
    path: Vec<u32>,
    placement: &Placement,
    reference: FragmentReference,
    fragment: &mut impl FnMut(FragmentReference) -> FragmentOutcome,
) -> RenderFlags {
    let mut flags = match fragment(reference) {
        FragmentOutcome::Placeholder(flags) => {
            segments.placeholder_at(interpolation, path);
            flags
        }
        FragmentOutcome::Segments(rendered, flags) => {
            segments.rendered(rendered, fragment_indent(placement));
            flags
        }
        FragmentOutcome::Truncated(rendered, flags) => {
            segments.rendered(rendered, fragment_indent(placement));
            flags
        }
    };
    if segments.overflowed() {
        flags.mark_byte_truncated();
    }
    flags
}

fn fragment_indent(
    placement: &Placement,
) -> Option<(&str, crux_indexer_protocol::prompt_text::PromptTextRange)> {
    match placement {
        Placement::Inline => None,
        Placement::Block {
            indent,
            indent_range: Some(range),
        } => Some((indent.as_str(), *range)),
        Placement::Block { .. } => None,
    }
}

fn render_known(
    segments: &mut PreviewSegments,
    text: &str,
    interpolation: u32,
    path: Vec<u32>,
    placement: Placement,
) {
    let Placement::Block {
        indent,
        indent_range,
    } = placement
    else {
        segments.known(text.to_owned(), interpolation, path);
        return;
    };
    for chunk in text.split_inclusive('\n') {
        segments.known(chunk.to_owned(), interpolation, path.clone());
        if chunk.ends_with('\n')
            && let Some(range) = indent_range
        {
            segments.authored_copy(indent.clone(), range);
        }
    }
}

fn render_sequence(
    segments: &mut PreviewSegments,
    interpolation: u32,
    items: &[ProjectedSequenceItem],
    indent: &str,
    indent_range: Option<crux_indexer_protocol::prompt_text::PromptTextRange>,
    fragment: &mut impl FnMut(FragmentReference) -> FragmentOutcome,
) -> RenderFlags {
    if !sequence_is_safe(items) {
        segments.placeholder(interpolation);
        return RenderFlags::default();
    }
    let mut unindented = segments.child(segments.remaining());
    let mut flags = render_sequence_items(&mut unindented, interpolation, items, &[], fragment);
    if unindented.overflowed() {
        flags.mark_byte_truncated();
    }
    segments.rendered(
        unindented.into_segments(),
        indent_range.map(|range| (indent, range)),
    );
    if segments.overflowed() {
        flags.mark_byte_truncated();
    }
    flags
}

fn sequence_is_safe(items: &[ProjectedSequenceItem]) -> bool {
    items.iter().all(|item| match &item.value {
        ProjectedValue::Scalar(_)
        | ProjectedValue::Omitted
        | ProjectedValue::Json(_)
        | ProjectedValue::Fragment { .. }
        | ProjectedValue::SemanticFragment { .. } => true,
        ProjectedValue::Sequence(nested) => sequence_is_safe(nested),
        ProjectedValue::Unknown => false,
    })
}

fn render_sequence_items(
    segments: &mut PreviewSegments,
    interpolation: u32,
    items: &[ProjectedSequenceItem],
    parent_path: &[u32],
    fragment: &mut impl FnMut(FragmentReference) -> FragmentOutcome,
) -> RenderFlags {
    let mut flags = RenderFlags::default();
    for item in items {
        let mut path = parent_path.to_vec();
        path.push(item.index);
        let separator_bytes = u64::from(!segments.is_empty());
        let mut rendered = segments.child(segments.remaining().saturating_sub(separator_bytes));
        let mut item_flags =
            render_sequence_item(&mut rendered, interpolation, &item.value, &path, fragment);
        if rendered.overflowed() {
            item_flags.mark_byte_truncated();
        }
        if !rendered.is_empty() {
            if !segments.is_empty() {
                segments.known("\n".to_owned(), interpolation, path);
            }
            segments.extend(rendered);
        }
        if segments.overflowed() {
            item_flags.mark_byte_truncated();
        }
        flags.merge(item_flags);
        if flags.is_truncated() {
            return flags;
        }
    }
    flags
}

fn render_sequence_item(
    segments: &mut PreviewSegments,
    interpolation: u32,
    value: &ProjectedValue,
    path: &[u32],
    fragment: &mut impl FnMut(FragmentReference) -> FragmentOutcome,
) -> RenderFlags {
    match value {
        ProjectedValue::Scalar(text) => {
            segments.known(text.clone(), interpolation, path.to_vec());
            RenderFlags::default()
        }
        ProjectedValue::Omitted => RenderFlags::default(),
        ProjectedValue::Sequence(nested) => {
            render_sequence_items(segments, interpolation, nested, path, fragment)
        }
        ProjectedValue::Json(value) => {
            segments.known(json::stringify(value), interpolation, path.to_vec());
            RenderFlags::default()
        }
        ProjectedValue::Fragment { candidate_id } => render_fragment(
            segments,
            interpolation,
            path.to_vec(),
            &Placement::Inline,
            FragmentReference::Document(*candidate_id),
            fragment,
        ),
        ProjectedValue::SemanticFragment { fragment: target } => render_fragment(
            segments,
            interpolation,
            path.to_vec(),
            &Placement::Inline,
            FragmentReference::Semantic(*target),
            fragment,
        ),
        ProjectedValue::Unknown => {
            unreachable!("sequence safety is checked before rendering")
        }
    }
}
