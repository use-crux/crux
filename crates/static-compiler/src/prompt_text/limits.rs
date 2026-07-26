use crux_indexer_protocol::prompt_text::{PromptTextQueryRequest, PromptTextTemplate};
use crux_indexer_syntax_oxc::prompt_text::ProjectedPromptTextTemplate;

pub(crate) fn template_allowed(
    projected: &ProjectedPromptTextTemplate,
    request: &PromptTextQueryRequest,
) -> bool {
    projected
        .islands
        .iter()
        .map(|island| island.text.len())
        .sum::<usize>()
        <= request.limits.max_template_bytes as usize
}

/// Retains the longest source-order prefix whose compact JSON objects fit.
///
/// The budget counts each complete template object plus commas between
/// retained objects. Array brackets and surrounding protocol envelopes are
/// deliberately excluded.
pub(crate) fn retain_output_prefix(
    templates: impl IntoIterator<Item = PromptTextTemplate>,
    max_output_bytes: u32,
) -> (Vec<PromptTextTemplate>, bool) {
    let max_output_bytes = max_output_bytes as usize;
    let mut retained = Vec::new();
    let mut used_bytes = 0usize;

    for template in templates {
        let Ok(serialized) = serde_json::to_vec(&template) else {
            return (retained, true);
        };
        let separator_bytes = usize::from(!retained.is_empty());
        let Some(next_used_bytes) = used_bytes
            .checked_add(separator_bytes)
            .and_then(|used| used.checked_add(serialized.len()))
        else {
            return (retained, true);
        };
        if next_used_bytes > max_output_bytes {
            return (retained, true);
        }

        used_bytes = next_used_bytes;
        retained.push(template);
    }

    (retained, false)
}
