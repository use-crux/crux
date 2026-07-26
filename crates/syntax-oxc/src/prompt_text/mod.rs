//! Tag-neutral PromptText candidate projection.
//!
//! This module recognizes TypeScript tagged-template syntax and preserves
//! literal/barrier mappings. It deliberately assigns no Crux identity and does
//! not classify Markdown.

mod candidates;
mod interpolation;
mod mapping;
mod projection;
#[cfg(test)]
mod tests;

pub use candidates::project;
pub use mapping::map_projected_range;
pub use projection::{ProjectedPromptText, ProjectedPromptTextTemplate, ProjectedTextIsland};
