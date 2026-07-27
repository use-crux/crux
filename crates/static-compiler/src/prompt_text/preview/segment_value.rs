use crux_indexer_protocol::prompt_text::PromptTextPreviewSegment;

pub(super) fn same_provenance(
    left: &PromptTextPreviewSegment,
    right: &PromptTextPreviewSegment,
) -> bool {
    match (left, right) {
        (
            PromptTextPreviewSegment::AuthoredLiteral {
                range: left_range, ..
            },
            PromptTextPreviewSegment::AuthoredLiteral {
                range: right_range, ..
            },
        ) => left_range == right_range,
        (
            PromptTextPreviewSegment::KnownValue {
                interpolation: left_interpolation,
                interpolation_path: left_path,
                ..
            },
            PromptTextPreviewSegment::KnownValue {
                interpolation: right_interpolation,
                interpolation_path: right_path,
                ..
            },
        )
        | (
            PromptTextPreviewSegment::Placeholder {
                interpolation: left_interpolation,
                interpolation_path: left_path,
                ..
            },
            PromptTextPreviewSegment::Placeholder {
                interpolation: right_interpolation,
                interpolation_path: right_path,
                ..
            },
        ) => left_interpolation == right_interpolation && left_path == right_path,
        (
            PromptTextPreviewSegment::Fragment {
                fragment_id: left_id,
                source_hash: left_hash,
                ..
            },
            PromptTextPreviewSegment::Fragment {
                fragment_id: right_id,
                source_hash: right_hash,
                ..
            },
        ) => left_id == right_id && left_hash == right_hash,
        _ => false,
    }
}

pub(super) fn text(segment: &PromptTextPreviewSegment) -> &str {
    match segment {
        PromptTextPreviewSegment::AuthoredLiteral { text, .. }
        | PromptTextPreviewSegment::KnownValue { text, .. }
        | PromptTextPreviewSegment::Fragment { text, .. }
        | PromptTextPreviewSegment::Placeholder { text, .. } => text,
    }
}

pub(super) fn text_mut(segment: &mut PromptTextPreviewSegment) -> &mut String {
    match segment {
        PromptTextPreviewSegment::AuthoredLiteral { text, .. }
        | PromptTextPreviewSegment::KnownValue { text, .. }
        | PromptTextPreviewSegment::Fragment { text, .. }
        | PromptTextPreviewSegment::Placeholder { text, .. } => text,
    }
}

pub(super) fn with_text(
    segment: &PromptTextPreviewSegment,
    text: String,
) -> PromptTextPreviewSegment {
    match segment {
        PromptTextPreviewSegment::AuthoredLiteral { range, .. } => {
            PromptTextPreviewSegment::AuthoredLiteral {
                text,
                range: *range,
            }
        }
        PromptTextPreviewSegment::KnownValue {
            interpolation,
            interpolation_path,
            ..
        } => PromptTextPreviewSegment::KnownValue {
            text,
            interpolation: *interpolation,
            interpolation_path: interpolation_path.clone(),
        },
        PromptTextPreviewSegment::Fragment {
            fragment_id,
            source_hash,
            ..
        } => PromptTextPreviewSegment::Fragment {
            text,
            fragment_id: fragment_id.clone(),
            source_hash: source_hash.clone(),
        },
        PromptTextPreviewSegment::Placeholder {
            interpolation,
            interpolation_path,
            ..
        } => PromptTextPreviewSegment::Placeholder {
            text,
            interpolation: *interpolation,
            interpolation_path: interpolation_path.clone(),
        },
    }
}
