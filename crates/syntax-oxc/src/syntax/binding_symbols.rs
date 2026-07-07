//! Binding-pattern helpers for Oxc semantic symbol evidence.

use oxc_ast::ast::BindingPattern;
use oxc_semantic::SymbolId;

/// Return binding symbol IDs in the same order as syntax initializer records.
pub(crate) fn binding_symbol_ids(pattern: &BindingPattern<'_>) -> Vec<Option<SymbolId>> {
    match pattern {
        BindingPattern::BindingIdentifier(identifier) => vec![identifier.symbol_id.get()],
        BindingPattern::ObjectPattern(pattern) => pattern
            .properties
            .iter()
            .flat_map(|property| binding_symbol_ids(&property.value))
            .chain(
                pattern
                    .rest
                    .iter()
                    .flat_map(|rest| binding_symbol_ids(&rest.argument)),
            )
            .collect(),
        BindingPattern::ArrayPattern(pattern) => pattern
            .elements
            .iter()
            .flatten()
            .flat_map(binding_symbol_ids)
            .chain(
                pattern
                    .rest
                    .iter()
                    .flat_map(|rest| binding_symbol_ids(&rest.argument)),
            )
            .collect(),
        BindingPattern::AssignmentPattern(pattern) => binding_symbol_ids(&pattern.left),
    }
}
