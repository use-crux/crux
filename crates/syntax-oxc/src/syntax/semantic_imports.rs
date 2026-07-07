//! Import binding lookup backed by Oxc semantic references.
//!
//! Import records are public syntax evidence. Symbol IDs are frontend-local
//! evidence used only to decide whether an identifier reference still points to
//! the import after lexical shadowing is considered.

use std::collections::HashMap;

use oxc_ast::ast::*;
use oxc_semantic::{Scoping, SymbolId};

use crate::protocol::StaticImportRecord;

type ImportsByLocalName = HashMap<String, StaticImportRecord>;

struct SemanticImportBinding {
    record: StaticImportRecord,
    symbol_id: Option<SymbolId>,
}

/// Resolves import records only when an identifier references the import symbol.
pub(crate) struct SemanticImportIndex<'a> {
    scoping: &'a Scoping,
    by_local_name: HashMap<String, SemanticImportBinding>,
}

impl<'a> SemanticImportIndex<'a> {
    /// Build an import index from syntax records and Oxc-assigned binding IDs.
    pub(crate) fn new(
        scoping: &'a Scoping,
        statements: &[Statement<'_>],
        imports: &ImportsByLocalName,
    ) -> Self {
        let mut by_local_name = HashMap::new();
        for statement in statements {
            let Statement::ImportDeclaration(import) = statement else {
                continue;
            };
            for specifier in import.specifiers.as_ref().into_iter().flatten() {
                let Some((local_name, symbol_id)) = import_binding(specifier) else {
                    continue;
                };
                let Some(record) = imports.get(local_name) else {
                    continue;
                };
                by_local_name.insert(
                    local_name.to_string(),
                    SemanticImportBinding {
                        record: record.clone(),
                        symbol_id,
                    },
                );
            }
        }
        Self {
            scoping,
            by_local_name,
        }
    }

    /// Iterate public import records in local-name keyed order.
    pub(crate) fn records(&self) -> impl Iterator<Item = &StaticImportRecord> {
        self.by_local_name.values().map(|binding| &binding.record)
    }

    /// Return the import record referenced by a callee expression, if any.
    pub(crate) fn record_for_callee(
        &self,
        expression: &Expression<'_>,
    ) -> Option<&StaticImportRecord> {
        match expression {
            Expression::Identifier(identifier) => self.record_for_identifier(identifier),
            Expression::StaticMemberExpression(member) => {
                self.record_for_member_receiver(&member.object)
            }
            _ => None,
        }
    }

    fn record_for_member_receiver(
        &self,
        expression: &Expression<'_>,
    ) -> Option<&StaticImportRecord> {
        match expression {
            Expression::Identifier(identifier) => self.record_for_identifier(identifier),
            Expression::StaticMemberExpression(member) => {
                self.record_for_member_receiver(&member.object)
            }
            _ => None,
        }
    }

    fn record_for_identifier(
        &self,
        identifier: &IdentifierReference<'_>,
    ) -> Option<&StaticImportRecord> {
        let binding = self.by_local_name.get(identifier.name.as_str())?;
        let expected_symbol_id = binding.symbol_id?;
        let reference_id = identifier.reference_id.get()?;
        let actual_symbol_id = self.scoping.get_reference(reference_id).symbol_id()?;
        (actual_symbol_id == expected_symbol_id).then_some(&binding.record)
    }
}

fn import_binding<'a>(
    specifier: &'a ImportDeclarationSpecifier<'a>,
) -> Option<(&'a str, Option<SymbolId>)> {
    match specifier {
        ImportDeclarationSpecifier::ImportSpecifier(specifier) => Some((
            specifier.local.name.as_str(),
            specifier.local.symbol_id.get(),
        )),
        ImportDeclarationSpecifier::ImportDefaultSpecifier(specifier) => Some((
            specifier.local.name.as_str(),
            specifier.local.symbol_id.get(),
        )),
        ImportDeclarationSpecifier::ImportNamespaceSpecifier(specifier) => Some((
            specifier.local.name.as_str(),
            specifier.local.symbol_id.get(),
        )),
    }
}
