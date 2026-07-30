use std::collections::{HashMap, HashSet};

use crux_indexer_protocol::prompt_text::{
    PromptTextAnalysisStatus, PromptTextFragment, PromptTextFragmentJoin, PromptTextPosition,
    PromptTextQueryRequest, PromptTextRange,
};
use crux_indexer_syntax_oxc::prompt_text::{ProjectedPromptTextTemplate, ProjectedValue, project};

/// One validated catalogue fragment projected by the same Oxc path as the
/// requesting document. It remains private to transient preview rendering.
pub(super) struct FragmentProjection {
    pub(super) id: String,
    pub(super) source_hash: String,
    pub(super) source: String,
    pub(super) root_candidate: u32,
    pub(super) templates: Vec<ProjectedPromptTextTemplate>,
    origin: PromptTextPosition,
    file: String,
}

pub(super) fn prepare(
    request: &PromptTextQueryRequest,
    document: &mut [ProjectedPromptTextTemplate],
) -> Vec<FragmentProjection> {
    if has_duplicate_fragment_ids(&request.fragments) {
        return Vec::new();
    }

    let mut fragments = request
        .fragments
        .iter()
        .filter_map(|fragment| project_fragment(request, fragment))
        .collect::<Vec<_>>();
    let targets = fragments
        .iter()
        .enumerate()
        .map(|(index, fragment)| (fragment.id.clone(), index as u32))
        .collect::<HashMap<_, _>>();

    apply_joins(
        &request.file,
        &request.revision.source_hash,
        None,
        document,
        &request.fragment_joins,
        &targets,
    );
    for fragment in &mut fragments {
        apply_joins(
            &fragment.file,
            &fragment.source_hash,
            Some(fragment.origin),
            &mut fragment.templates,
            &request.fragment_joins,
            &targets,
        );
    }
    fragments
}

fn project_fragment(
    request: &PromptTextQueryRequest,
    fragment: &PromptTextFragment,
) -> Option<FragmentProjection> {
    let mut query = request.clone();
    query.file.clone_from(&fragment.file);
    query.revision.open_epoch = 0;
    query.revision.version = 0;
    query.revision.source_hash.clone_from(&fragment.source_hash);
    query.source.clone_from(&fragment.snippet);
    query.fragments.clear();
    query.fragment_joins.clear();

    let mut projected = project(&query);
    if projected.status != PromptTextAnalysisStatus::Complete {
        return None;
    }
    for template in &mut projected.templates {
        if !super::super::limits::template_allowed(template, &query) {
            template.template.status = PromptTextAnalysisStatus::Truncated;
        }
    }
    let root = projected.templates.iter().find(|template| {
        shift_range(template.template.range, fragment.range.start) == Some(fragment.range)
            && template.template.status == PromptTextAnalysisStatus::Complete
    })?;
    Some(FragmentProjection {
        id: fragment.id.clone(),
        source_hash: fragment.source_hash.clone(),
        source: fragment.snippet.clone(),
        root_candidate: root.template.candidate_id,
        templates: projected.templates,
        origin: fragment.range.start,
        file: fragment.file.clone(),
    })
}

fn apply_joins(
    file: &str,
    source_hash: &str,
    origin: Option<PromptTextPosition>,
    templates: &mut [ProjectedPromptTextTemplate],
    joins: &[PromptTextFragmentJoin],
    targets: &HashMap<String, u32>,
) {
    for template in templates {
        let Some(template_range) = shifted_or_local(template.template.range, origin) else {
            continue;
        };
        for interpolation in &mut template.interpolations {
            if interpolation.value != ProjectedValue::Unknown {
                continue;
            }
            let Some(barrier) = template
                .template
                .interpolation_barriers
                .iter()
                .find(|barrier| barrier.index == interpolation.index)
            else {
                continue;
            };
            let Some(expression_range) = shifted_or_local(barrier.expression_range, origin) else {
                continue;
            };
            let mut matches = joins.iter().filter(|join| {
                join.key.file == file
                    && join.key.source_hash == source_hash
                    && join.key.template_range == template_range
                    && join.key.interpolation == interpolation.index
                    && join.key.expression_range == expression_range
                    && targets.contains_key(&join.fragment_id)
            });
            let Some(join) = matches.next() else {
                continue;
            };
            if matches.next().is_some() {
                continue;
            }
            interpolation.value = ProjectedValue::SemanticFragment {
                fragment: targets[&join.fragment_id],
            };
        }
    }
}

fn has_duplicate_fragment_ids(fragments: &[PromptTextFragment]) -> bool {
    let mut ids = HashSet::with_capacity(fragments.len());
    fragments
        .iter()
        .any(|fragment| !ids.insert(fragment.id.as_str()))
}

fn shifted_or_local(
    range: PromptTextRange,
    origin: Option<PromptTextPosition>,
) -> Option<PromptTextRange> {
    origin.map_or(Some(range), |position| shift_range(range, position))
}

fn shift_range(range: PromptTextRange, origin: PromptTextPosition) -> Option<PromptTextRange> {
    Some(PromptTextRange {
        start: shift_position(range.start, origin)?,
        end: shift_position(range.end, origin)?,
    })
}

fn shift_position(
    position: PromptTextPosition,
    origin: PromptTextPosition,
) -> Option<PromptTextPosition> {
    Some(PromptTextPosition {
        line: origin.line.checked_add(position.line)?,
        character: if position.line == 0 {
            origin.character.checked_add(position.character)?
        } else {
            position.character
        },
    })
}
