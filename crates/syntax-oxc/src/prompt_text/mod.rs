//! Tag-neutral PromptText candidate projection.
//!
//! This module recognizes TypeScript tagged-template syntax and preserves
//! literal/barrier mappings. It deliberately assigns no Crux identity and does
//! not classify Markdown.

mod candidates;
mod cooked;
mod fragments;
mod interpolation;
mod mapping;
mod normalization;
mod projection;
mod string_refactors;
#[cfg(test)]
mod tests;
mod value;

pub use candidates::project;
pub use mapping::{ProjectedRangeMapper, map_projected_range};
pub use projection::{
    ProjectedInterpolation, ProjectedPromptText, ProjectedPromptTextTemplate, ProjectedTextIsland,
};
pub use value::{ProjectedJsonValue, ProjectedSequenceItem, ProjectedValue};
