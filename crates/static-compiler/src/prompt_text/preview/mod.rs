mod composition;
mod fragments;
mod json;
mod segment_value;
mod segments;
mod types;
mod value;
mod weave;

use std::{cell::RefCell, collections::HashMap};

use crux_indexer_protocol::prompt_text::{
    PromptTextPreview, PromptTextPreviewEvidence, PromptTextPreviewStatus,
    PromptTextPreviewTruncation, PromptTextPreviewTruncationReason,
};
use crux_indexer_syntax_oxc::prompt_text::ProjectedPromptTextTemplate;

use self::segments::FragmentProvenance;
use self::types::{FragmentOutcome, FragmentReference, Placement, RenderFlags, RenderTruncation};

pub(crate) fn render_all(
    request: &crux_indexer_protocol::prompt_text::PromptTextQueryRequest,
    source: &str,
    source_hash: &str,
    max_preview_bytes: u32,
    max_fragment_depth: u32,
    projected: &mut [ProjectedPromptTextTemplate],
) {
    let fragment_projections = fragments::prepare(request, projected);
    let renderer = Renderer {
        source,
        source_hash,
        max_preview_bytes,
        max_fragment_depth,
        templates: projected,
        fragments: &fragment_projections,
        memo: RefCell::new(HashMap::new()),
    };
    let previews = (0..projected.len())
        .map(|candidate| {
            renderer
                .render(SourceKey::Document, candidate as u32, None, &mut Vec::new())
                .preview
        })
        .collect::<Vec<_>>();
    for (template, preview) in projected.iter_mut().zip(previews) {
        if template.template.status
            == crux_indexer_protocol::prompt_text::PromptTextAnalysisStatus::Complete
        {
            template.template.preview = preview;
        }
    }
}

struct Renderer<'a> {
    source: &'a str,
    source_hash: &'a str,
    max_preview_bytes: u32,
    max_fragment_depth: u32,
    templates: &'a [ProjectedPromptTextTemplate],
    fragments: &'a [fragments::FragmentProjection],
    memo: RefCell<HashMap<RenderMemoKey, RenderedPreview>>,
}

impl Renderer<'_> {
    fn render(
        &self,
        source_key: SourceKey,
        candidate: u32,
        provenance: Option<FragmentProvenance>,
        stack: &mut Vec<TemplateKey>,
    ) -> RenderedPreview {
        let Some((source, projected)) = self.projected(source_key, candidate) else {
            return RenderedPreview::default();
        };
        let key = TemplateKey {
            source: source_key,
            candidate,
        };
        if stack.contains(&key) {
            return RenderedPreview::default();
        }
        let memo_key = RenderMemoKey {
            template: key,
            depth: stack.len() as u32,
            provenance: provenance.clone(),
        };
        if let Some(rendered) = self.memo.borrow().get(&memo_key) {
            return rendered.clone();
        }
        stack.push(key);
        let (segments, flags) = composition::render(
            source,
            projected,
            self.max_preview_bytes,
            provenance,
            &mut |fragment| self.fragment(source_key, fragment, stack),
        );
        stack.pop();
        let emitted_bytes = segments.bytes() as u32;
        let truncation = flags.truncation.map(|reason| {
            let (reason, limit) = match reason {
                RenderTruncation::MaxPreviewBytes => (
                    PromptTextPreviewTruncationReason::MaxPreviewBytes,
                    self.max_preview_bytes,
                ),
                RenderTruncation::MaxFragmentDepth => (
                    PromptTextPreviewTruncationReason::MaxFragmentDepth,
                    self.max_fragment_depth,
                ),
            };
            PromptTextPreviewTruncation {
                reason,
                limit,
                emitted_bytes,
            }
        });
        let rendered = RenderedPreview {
            preview: PromptTextPreview {
                status: if flags.is_truncated() {
                    PromptTextPreviewStatus::Truncated
                } else {
                    PromptTextPreviewStatus::Complete
                },
                evidence: Some(if flags.semantic_exact {
                    PromptTextPreviewEvidence::SemanticExact
                } else {
                    PromptTextPreviewEvidence::SyntaxExact
                }),
                text: segments.text(),
                segments: segments.into_segments(),
                truncation,
            },
            flags,
        };
        if rendered.preview.segments.is_empty()
            && !rendered.flags.is_truncated()
            && !rendered.flags.cycle_sensitive
        {
            self.memo.borrow_mut().insert(memo_key, rendered.clone());
        }
        rendered
    }

    fn projected(
        &self,
        source: SourceKey,
        candidate: u32,
    ) -> Option<(&str, &ProjectedPromptTextTemplate)> {
        match source {
            SourceKey::Document => Some((self.source, self.templates.get(candidate as usize)?)),
            SourceKey::Fragment(fragment) => {
                let fragment = self.fragments.get(fragment as usize)?;
                Some((
                    &fragment.source,
                    fragment.templates.get(candidate as usize)?,
                ))
            }
        }
    }

    fn fragment(
        &self,
        owner: SourceKey,
        reference: FragmentReference,
        stack: &mut Vec<TemplateKey>,
    ) -> FragmentOutcome {
        let (source, candidate, semantic, provenance) = match reference {
            FragmentReference::Document(candidate) => (
                owner,
                candidate,
                false,
                FragmentProvenance {
                    id: format!("document:{candidate}"),
                    source_hash: self.source_hash(owner).to_owned(),
                },
            ),
            FragmentReference::Semantic(fragment) => {
                let Some(target) = self.fragments.get(fragment as usize) else {
                    return FragmentOutcome::Placeholder(RenderFlags::default());
                };
                (
                    SourceKey::Fragment(fragment),
                    target.root_candidate,
                    true,
                    FragmentProvenance {
                        id: target.id.clone(),
                        source_hash: target.source_hash.clone(),
                    },
                )
            }
        };
        let Some((_, target)) = self.projected(source, candidate) else {
            return FragmentOutcome::Placeholder(RenderFlags::default());
        };
        if target.template.status
            != crux_indexer_protocol::prompt_text::PromptTextAnalysisStatus::Complete
        {
            return FragmentOutcome::Placeholder(RenderFlags::default());
        }
        let key = TemplateKey { source, candidate };
        if stack.contains(&key) {
            return FragmentOutcome::Placeholder(RenderFlags {
                semantic_exact: semantic,
                cycle_sensitive: true,
                ..RenderFlags::default()
            });
        }
        if stack.len() as u64 > u64::from(self.max_fragment_depth) {
            return FragmentOutcome::Truncated(
                Vec::new(),
                RenderFlags {
                    truncation: Some(RenderTruncation::MaxFragmentDepth),
                    ..RenderFlags::default()
                },
            );
        }
        let mut rendered = self.render(source, candidate, Some(provenance), stack);
        if semantic {
            rendered.flags.semantic_exact = true;
        }
        let segments = rendered.preview.segments;
        if rendered.flags.is_truncated() {
            FragmentOutcome::Truncated(segments, rendered.flags)
        } else {
            FragmentOutcome::Segments(segments, rendered.flags)
        }
    }

    fn source_hash(&self, source: SourceKey) -> &str {
        match source {
            SourceKey::Document => self.source_hash,
            SourceKey::Fragment(fragment) => &self.fragments[fragment as usize].source_hash,
        }
    }
}

#[derive(Clone, Default)]
struct RenderedPreview {
    preview: PromptTextPreview,
    flags: RenderFlags,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
enum SourceKey {
    Document,
    Fragment(u32),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
struct TemplateKey {
    source: SourceKey,
    candidate: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
struct RenderMemoKey {
    template: TemplateKey,
    depth: u32,
    provenance: Option<FragmentProvenance>,
}
