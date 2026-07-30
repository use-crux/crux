use crux_indexer_protocol::prompt_text::{PromptTextPreviewSegment, PromptTextRange};

use super::segment_value::{
    same_provenance, text as segment_text, text_mut as segment_text_mut, with_text,
};

pub(super) struct PreviewSegments {
    values: Vec<PromptTextPreviewSegment>,
    provenance: Option<FragmentProvenance>,
    limit: u64,
    bytes: u64,
    overflowed: bool,
    overflowed_segment: Option<PromptTextPreviewSegment>,
}

#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub(super) struct FragmentProvenance {
    pub(super) id: String,
    pub(super) source_hash: String,
}

impl PreviewSegments {
    pub(super) fn new(limit: u64) -> Self {
        Self::scoped(limit, None)
    }

    pub(super) fn scoped(limit: u64, provenance: Option<FragmentProvenance>) -> Self {
        Self {
            values: Vec::new(),
            provenance,
            limit,
            bytes: 0,
            overflowed: false,
            overflowed_segment: None,
        }
    }

    pub(super) fn child(&self, limit: u64) -> Self {
        Self::scoped(limit, self.provenance.clone())
    }

    pub(super) fn push(&mut self, segment: PromptTextPreviewSegment) {
        let segment = self.apply_provenance(segment);
        if self.overflowed || segment_text(&segment).is_empty() {
            return;
        }
        let bytes = segment_text(&segment).len() as u64;
        if self
            .values
            .last()
            .is_some_and(|previous| same_provenance(previous, &segment))
        {
            if self.bytes.saturating_add(bytes) > self.limit {
                let removed = self.values.pop().expect("matching previous segment");
                self.bytes = self
                    .bytes
                    .saturating_sub(segment_text(&removed).len() as u64);
                self.overflowed = true;
                self.overflowed_segment = Some(segment);
                return;
            }
            let previous = self.values.last_mut().expect("matching previous segment");
            segment_text_mut(previous).push_str(segment_text(&segment));
            self.bytes += bytes;
            return;
        }
        if self.bytes.saturating_add(bytes) > self.limit {
            self.overflowed = true;
            self.overflowed_segment = Some(segment);
            return;
        }
        self.bytes += bytes;
        self.values.push(segment);
    }

    pub(super) fn extend(&mut self, other: PreviewSegments) {
        let overflowed = other.overflowed;
        let overflowed_segment = other.overflowed_segment;
        for segment in other.values {
            self.push(segment);
            if self.overflowed {
                return;
            }
        }
        if overflowed {
            if let Some(segment) = &overflowed_segment
                && self
                    .values
                    .last()
                    .is_some_and(|previous| same_provenance(previous, segment))
            {
                let removed = self.values.pop().expect("matching previous segment");
                self.bytes = self
                    .bytes
                    .saturating_sub(segment_text(&removed).len() as u64);
            }
            self.overflowed = true;
            self.overflowed_segment = overflowed_segment;
        }
    }

    pub(super) fn is_empty(&self) -> bool {
        self.values.is_empty()
    }

    pub(super) fn bytes(&self) -> u64 {
        self.bytes
    }

    pub(super) fn remaining(&self) -> u64 {
        self.limit.saturating_sub(self.bytes)
    }

    pub(super) fn overflowed(&self) -> bool {
        self.overflowed
    }

    pub(super) fn authored_copy(&mut self, text: String, range: PromptTextRange) {
        self.push(PromptTextPreviewSegment::AuthoredLiteral { text, range });
    }

    pub(super) fn known(&mut self, text: String, interpolation: u32, interpolation_path: Vec<u32>) {
        if text.is_empty() {
            return;
        }
        self.push(PromptTextPreviewSegment::KnownValue {
            text,
            interpolation,
            interpolation_path,
        });
    }

    pub(super) fn placeholder(&mut self, interpolation: u32) {
        self.placeholder_at(interpolation, Vec::new());
    }

    pub(super) fn placeholder_at(&mut self, interpolation: u32, interpolation_path: Vec<u32>) {
        self.push(PromptTextPreviewSegment::Placeholder {
            text: "⟪unknown⟫".to_owned(),
            interpolation,
            interpolation_path,
        });
    }

    pub(super) fn rendered(
        &mut self,
        rendered: Vec<PromptTextPreviewSegment>,
        indent: Option<(&str, PromptTextRange)>,
    ) {
        if indent.is_none() {
            for segment in rendered {
                self.push(segment);
            }
            return;
        }
        for segment in rendered {
            let text = segment_text(&segment);
            let chunks = text.split_inclusive('\n').collect::<Vec<_>>();
            for (index, chunk) in chunks.iter().enumerate() {
                self.push(with_text(&segment, (*chunk).to_owned()));
                if chunk.ends_with('\n')
                    && let Some((indent, range)) = indent
                {
                    self.authored_copy(indent.to_owned(), range);
                } else if index + 1 < chunks.len()
                    && let Some((indent, range)) = indent
                {
                    self.authored_copy(indent.to_owned(), range);
                }
            }
        }
    }

    pub(super) fn text(&self) -> String {
        self.values.iter().map(segment_text).collect::<String>()
    }

    pub(super) fn into_segments(self) -> Vec<PromptTextPreviewSegment> {
        self.values
    }

    fn apply_provenance(&self, segment: PromptTextPreviewSegment) -> PromptTextPreviewSegment {
        let Some(provenance) = &self.provenance else {
            return segment;
        };
        match segment {
            PromptTextPreviewSegment::AuthoredLiteral { text, .. }
            | PromptTextPreviewSegment::KnownValue { text, .. } => {
                PromptTextPreviewSegment::Fragment {
                    text,
                    fragment_id: provenance.id.clone(),
                    source_hash: provenance.source_hash.clone(),
                }
            }
            segment => segment,
        }
    }
}

impl Default for PreviewSegments {
    fn default() -> Self {
        Self::new(u64::MAX)
    }
}
