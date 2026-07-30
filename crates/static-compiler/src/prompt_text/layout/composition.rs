use crux_indexer_syntax_oxc::prompt_text::ProjectedPromptTextTemplate;

use super::candidate::Proposal;

#[derive(Debug, PartialEq, Eq)]
enum Atom {
    Literal {
        island: usize,
        text: String,
    },
    Interpolation {
        index: usize,
        block: bool,
        target_items: Option<usize>,
    },
}

/// Proves the composition delta for empty, one-item, and two-item target
/// sequences. The pre-edit inline sequence has no runtime value, so the
/// comparison applies only the permitted target placement/gap transformation
/// to the pre-edit atoms, then compares that expectation to the reparsed
/// template. Island and interpolation identities retain provenance.
pub(super) fn equivalent(
    before: &ProjectedPromptTextTemplate,
    after: &ProjectedPromptTextTemplate,
    target: usize,
    proposal: &Proposal,
) -> bool {
    let before_placements = placements(before);
    let after_placements = placements(after);
    if before_placements.len() != after_placements.len()
        || before_placements.get(target) != Some(&false)
        || after_placements.get(target) != Some(&true)
        || before_placements
            .iter()
            .zip(&after_placements)
            .enumerate()
            .any(|(index, (left, right))| index != target && left != right)
    {
        return false;
    }

    let Some(expected_islands) = expected_islands(before, target, proposal) else {
        return false;
    };
    let mut expected_placements = before_placements;
    expected_placements[target] = true;
    (0..=2).all(|target_items| {
        atoms(
            &expected_islands,
            &expected_placements,
            target,
            target_items,
        ) == atoms(
            &after
                .islands
                .iter()
                .map(|island| island.text.clone())
                .collect::<Vec<_>>(),
            &after_placements,
            target,
            target_items,
        )
    })
}

fn expected_islands(
    before: &ProjectedPromptTextTemplate,
    target: usize,
    proposal: &Proposal,
) -> Option<Vec<String>> {
    before
        .islands
        .iter()
        .enumerate()
        .map(|(index, island)| {
            if index == target && proposal.left_content {
                replace(
                    &island.text,
                    proposal.left_gap.clone(),
                    &format!("\n{}", proposal.normalized_indent),
                )
            } else if index == target + 1 && proposal.right_content {
                replace(
                    &island.text,
                    proposal.right_gap.clone(),
                    &format!("\n{}", proposal.normalized_indent),
                )
            } else {
                Some(island.text.clone())
            }
        })
        .collect()
}

fn atoms(islands: &[String], placements: &[bool], target: usize, target_items: usize) -> Vec<Atom> {
    let mut result = Vec::with_capacity(islands.len() + placements.len());
    for (index, island) in islands.iter().enumerate() {
        result.push(Atom::Literal {
            island: index,
            text: island.clone(),
        });
        if let Some(block) = placements.get(index) {
            result.push(Atom::Interpolation {
                index,
                block: *block,
                target_items: (index == target).then_some(target_items),
            });
        }
    }
    result
}

fn replace(text: &str, range: std::ops::Range<usize>, replacement: &str) -> Option<String> {
    let mut result = String::with_capacity(text.len() - range.len() + replacement.len());
    result.push_str(text.get(..range.start)?);
    result.push_str(replacement);
    result.push_str(text.get(range.end..)?);
    Some(result)
}

pub(super) fn placements(projected: &ProjectedPromptTextTemplate) -> Vec<bool> {
    (0..projected.template.interpolation_barriers.len())
        .map(|index| {
            let left = &projected.islands[index].text;
            let right = &projected.islands[index + 1].text;
            let unique_left = index == 0 || left.contains('\n');
            let unique_right = index + 1 == projected.template.interpolation_barriers.len()
                || right.contains('\n');
            let left_line = left.rsplit('\n').next().unwrap_or(left);
            let right_line = right.split('\n').next().unwrap_or(right);
            unique_left
                && unique_right
                && left_line
                    .bytes()
                    .chain(right_line.bytes())
                    .all(|byte| matches!(byte, b' ' | b'\t'))
        })
        .collect()
}
