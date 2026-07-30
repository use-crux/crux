//! Rust-owned counterfactual proof for optional line-isolation edits.

mod candidate;
mod composition;
mod counterfactual;
mod signature;
mod source;

use crux_indexer_protocol::prompt_text::PromptTextQueryRequest;
use crux_indexer_syntax_oxc::prompt_text::ProjectedPromptTextTemplate;

/// Proves each eligible barrier independently against the exact request.
pub(super) fn prove_all(
    request: &PromptTextQueryRequest,
    templates: &mut [ProjectedPromptTextTemplate],
) {
    for template_index in 0..templates.len() {
        let barrier_count = templates[template_index]
            .template
            .interpolation_barriers
            .len();
        for barrier_index in 0..barrier_count {
            let Some(proposal) =
                candidate::propose(&request.source, &templates[template_index], barrier_index)
            else {
                continue;
            };
            if !counterfactual::proves(request, templates, template_index, barrier_index, &proposal)
            {
                continue;
            }
            templates[template_index].template.interpolation_barriers[barrier_index]
                .line_isolation_edit = Some(proposal.edit);
        }
    }
}
