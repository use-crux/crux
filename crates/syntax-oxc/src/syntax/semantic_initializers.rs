//! Scope-aware initializer visibility backed by Oxc semantic analysis.
//!
//! Oxc owns lexical scope construction. Crux adds one source-position rule:
//! matches may resolve only initializers declared earlier in the visible scope
//! chain, so later `const` declarations and nested shadows cannot leak backward.

use std::collections::{HashMap, HashSet};

use oxc_ast::ast::IdentifierReference;
use oxc_ast::ast::Program;
use oxc_semantic::{ScopeId, Scoping, SymbolId};
use oxc_span::Span;

use crate::{
    protocol::{StaticInitializerRecord, StaticSyntaxValue},
    syntax::{
        semantic_imports::SemanticImportIndex,
        semantic_initializer_walk::collect_semantic_initializers, source::SourceView,
    },
};

#[derive(Clone)]
pub(super) struct ScopedInitializer {
    pub(super) symbol_id: Option<SymbolId>,
    pub(super) value_start: u32,
    pub(super) record: StaticInitializerRecord,
}

/// Indexes local initializers by the semantic scope that owns their binding.
pub(crate) struct SemanticInitializerIndex<'a> {
    scoping: &'a Scoping,
    by_scope: HashMap<ScopeId, Vec<ScopedInitializer>>,
    by_symbol: HashMap<SymbolId, StaticInitializerRecord>,
}

impl<'a> SemanticInitializerIndex<'a> {
    /// Build a visibility index from the parsed program and Oxc's scope tree.
    pub(crate) fn new(
        scoping: &'a Scoping,
        view: &SourceView<'_>,
        program: &Program<'_>,
        imports: &SemanticImportIndex<'_>,
    ) -> Self {
        let by_scope = collect_semantic_initializers(scoping, view, program, imports);
        let by_symbol = by_scope
            .values()
            .flatten()
            .filter_map(|initializer| {
                initializer
                    .symbol_id
                    .map(|symbol_id| (symbol_id, initializer.record.clone()))
            })
            .collect();
        Self {
            scoping,
            by_scope,
            by_symbol,
        }
    }

    /// Return the initializer value referenced by an identifier, if known.
    pub(crate) fn value_for_identifier(
        &self,
        identifier: &IdentifierReference<'_>,
    ) -> Option<StaticSyntaxValue> {
        let reference_id = identifier.reference_id.get()?;
        let symbol_id = self.scoping.get_reference(reference_id).symbol_id()?;
        self.by_symbol
            .get(&symbol_id)
            .map(|initializer| initializer.value.clone())
    }

    /// Return initializers visible from `scope_id` before the match `span`.
    pub(crate) fn visible_before(
        &self,
        scope_id: ScopeId,
        span: Span,
    ) -> Vec<StaticInitializerRecord> {
        let mut seen = HashSet::new();
        let mut visible = Vec::new();
        for ancestor in self.scoping.scope_ancestors(scope_id) {
            let Some(initializers) = self.by_scope.get(&ancestor) else {
                continue;
            };
            for initializer in initializers.iter().rev() {
                if initializer.value_start >= span.start
                    || !seen.insert(initializer.record.name.clone())
                {
                    continue;
                }
                visible.push(initializer.clone());
            }
        }
        visible.sort_by(|a, b| {
            a.value_start
                .cmp(&b.value_start)
                .then_with(|| a.record.name.cmp(&b.record.name))
        });
        visible
            .into_iter()
            .map(|initializer| initializer.record)
            .collect()
    }
}
