use crux_indexer_protocol::prompt_text::{
    PromptTextAnalysisStatus, PromptTextQueryRequest, PromptTextSourceMapping,
};
use crux_indexer_syntax_oxc::prompt_text::ProjectedPromptTextTemplate;

use super::{candidate::Proposal, composition, signature, source};
use crate::prompt_text::{limits, markdown};

pub(super) fn proves(
    request: &PromptTextQueryRequest,
    original: &[ProjectedPromptTextTemplate],
    template_index: usize,
    barrier_index: usize,
    proposal: &Proposal,
) -> bool {
    let Some(counter_source) = apply(&request.source, proposal) else {
        return false;
    };
    let mut counter_request = request.clone();
    counter_request.source = counter_source;
    let mut counter = crux_indexer_syntax_oxc::prompt_text::project(&counter_request);
    if counter.status != PromptTextAnalysisStatus::Complete
        || counter.templates.len() != original.len()
    {
        return false;
    }
    for projected in &mut counter.templates {
        if !limits::template_allowed(projected, &counter_request) {
            return false;
        }
        markdown::classify(&counter_request.source, projected);
    }

    original
        .iter()
        .zip(&counter.templates)
        .enumerate()
        .all(|(index, (before, after))| {
            if index == template_index {
                target_equivalent(
                    &request.source,
                    &counter_request.source,
                    before,
                    after,
                    barrier_index,
                    proposal,
                )
            } else {
                candidate_equivalent(&request.source, &counter_request.source, before, after)
            }
        })
}

fn apply(source_text: &str, proposal: &Proposal) -> Option<String> {
    let mut counter = String::with_capacity(
        source_text.len() - proposal.source_range.len() + proposal.edit.new_text.len(),
    );
    counter.push_str(source_text.get(..proposal.source_range.start)?);
    counter.push_str(&proposal.edit.new_text);
    counter.push_str(source_text.get(proposal.source_range.end..)?);
    Some(counter)
}

fn candidate_equivalent(
    before_source: &str,
    after_source: &str,
    before: &ProjectedPromptTextTemplate,
    after: &ProjectedPromptTextTemplate,
) -> bool {
    before.template.candidate_id == after.template.candidate_id
        && before.template.status == after.template.status
        && source::text(before_source, before.template.tag_range)
            == source::text(after_source, after.template.tag_range)
        && expressions_equal(before_source, after_source, before, after)
        && before.interpolations == after.interpolations
        && before
            .islands
            .iter()
            .map(|island| &island.text)
            .eq(after.islands.iter().map(|island| &island.text))
        && composition::placements(before) == composition::placements(after)
        && signature::markdown(&before.template) == signature::markdown(&after.template)
        && mapping_signature(before_source, &before.template.mappings)
            == mapping_signature(after_source, &after.template.mappings)
}

fn target_equivalent(
    before_source: &str,
    after_source: &str,
    before: &ProjectedPromptTextTemplate,
    after: &ProjectedPromptTextTemplate,
    target: usize,
    proposal: &Proposal,
) -> bool {
    if before.template.candidate_id != after.template.candidate_id
        || before.template.status != after.template.status
        || source::text(before_source, before.template.tag_range)
            != source::text(after_source, after.template.tag_range)
        || !expressions_equal(before_source, after_source, before, after)
        || before.interpolations != after.interpolations
        || before.islands.len() != after.islands.len()
        || signature::markdown(&before.template) != signature::markdown(&after.template)
    {
        return false;
    }
    composition::equivalent(before, after, target, proposal)
        && retained_mapping_signature(before_source, before, proposal.source_range.clone())
            == retained_mapping_signature(
                after_source,
                after,
                proposal.source_range.start
                    ..proposal.source_range.start + proposal.edit.new_text.len(),
            )
}

fn expressions_equal(
    before_source: &str,
    after_source: &str,
    before: &ProjectedPromptTextTemplate,
    after: &ProjectedPromptTextTemplate,
) -> bool {
    before.template.interpolation_barriers.len() == after.template.interpolation_barriers.len()
        && before
            .template
            .interpolation_barriers
            .iter()
            .zip(&after.template.interpolation_barriers)
            .all(|(left, right)| {
                left.index == right.index
                    && source::text(before_source, left.range)
                        == source::text(after_source, right.range)
                    && source::text(before_source, left.expression_range)
                        == source::text(after_source, right.expression_range)
            })
}

fn mapping_signature(
    source_text: &str,
    mappings: &[PromptTextSourceMapping],
) -> Option<Vec<(u32, u32, u32, String)>> {
    mappings
        .iter()
        .map(|mapping| {
            Some((
                mapping.island,
                mapping.projection_range.start,
                mapping.projection_range.end,
                source::text(source_text, mapping.source_range)?.to_owned(),
            ))
        })
        .collect()
}

fn retained_mapping_signature(
    source_text: &str,
    projected: &ProjectedPromptTextTemplate,
    edited: std::ops::Range<usize>,
) -> Option<Vec<(u32, String, String)>> {
    let mut signature = Vec::new();
    for mapping in &projected.template.mappings {
        let source_range = source::byte_range(source_text, mapping.source_range)?;
        let island = projected.islands.get(mapping.island as usize)?;
        let projection_start = utf16_byte_offset(&island.text, mapping.projection_range.start)?;
        let projection_end = utf16_byte_offset(&island.text, mapping.projection_range.end)?;
        let projected_text = island.text.get(projection_start..projection_end)?;
        let authored_text = source_text.get(source_range.clone())?;
        if !ranges_overlap(&source_range, &edited) {
            signature.push((
                mapping.island,
                projected_text.to_owned(),
                authored_text.to_owned(),
            ));
            continue;
        }
        if source_range.start >= edited.start && source_range.end <= edited.end {
            continue;
        }
        // Only a direct linear mapping can be clipped at the edit edge.
        if projected_text != authored_text {
            return None;
        }
        let prefix = edited
            .start
            .saturating_sub(source_range.start)
            .min(authored_text.len());
        if prefix > 0 {
            signature.push((
                mapping.island,
                projected_text.get(..prefix)?.to_owned(),
                authored_text.get(..prefix)?.to_owned(),
            ));
        }
        let suffix = edited
            .end
            .saturating_sub(source_range.start)
            .min(authored_text.len());
        if suffix < authored_text.len() {
            signature.push((
                mapping.island,
                projected_text.get(suffix..)?.to_owned(),
                authored_text.get(suffix..)?.to_owned(),
            ));
        }
    }
    Some(signature)
}

fn ranges_overlap(left: &std::ops::Range<usize>, right: &std::ops::Range<usize>) -> bool {
    left.start < right.end && right.start < left.end
}

fn utf16_byte_offset(text: &str, target: u32) -> Option<usize> {
    let mut offset = 0u32;
    for (byte, character) in text.char_indices() {
        if offset == target {
            return Some(byte);
        }
        offset = offset.checked_add(character.len_utf16() as u32)?;
        if offset > target {
            return None;
        }
    }
    (offset == target).then_some(text.len())
}
