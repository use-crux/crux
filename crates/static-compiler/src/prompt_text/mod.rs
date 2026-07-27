//! Transient PromptText analysis facade.
//!
//! Oxc supplies tag-neutral literal projections. This module is the sole
//! production Markdown classifier and returns only normalized protocol data.

mod limits;
mod markdown;
mod preview;
mod ranges;
mod structure;
#[cfg(test)]
mod tests;

use crux_indexer_protocol::prompt_text::{
    PromptTextAnalysisStatus, PromptTextQueryRequest, PromptTextQueryResponse,
};

/// Analyzes one exact open-document revision without entering index stages.
pub fn analyze(request: PromptTextQueryRequest) -> PromptTextQueryResponse {
    let mut projection = crux_indexer_syntax_oxc::prompt_text::project(&request);
    for projected in &mut projection.templates {
        if !limits::template_allowed(projected, &request) {
            projected.template.status = PromptTextAnalysisStatus::Truncated;
            continue;
        }
        markdown::classify(&request.source, projected);
        preview::retain_empty_preview(&mut projected.template);
    }
    let (templates, output_truncated) = limits::retain_output_prefix(
        projection
            .templates
            .into_iter()
            .map(|projected| projected.template),
        request.limits.max_output_bytes,
    );
    if output_truncated {
        projection.status = PromptTextAnalysisStatus::Truncated;
    }

    PromptTextQueryResponse {
        protocol_version: request.protocol_version,
        file: request.file,
        revision: request.revision,
        status: projection.status,
        templates,
    }
}
