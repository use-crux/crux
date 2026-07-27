use std::collections::HashMap;

use oxc_ast::{AstKind, ast::*};
use oxc_semantic::{Scoping, Semantic, SymbolId};
use oxc_span::{GetSpan, Span};

use super::value::{TagBinding, binding, transparent};

#[derive(Debug, Clone)]
struct Candidate {
    binding: Option<TagBinding>,
}

/// Scope-aware index of the deliberately narrow same-document fragment forms.
pub(super) struct FragmentIndex {
    candidates: Vec<Candidate>,
    candidate_ids: HashMap<(u32, u32), u32>,
    identifiers: HashMap<SymbolId, u32>,
    properties: HashMap<(SymbolId, String), Option<u32>>,
}

impl FragmentIndex {
    pub(super) fn new(semantic: &Semantic<'_>, tagged: &[&TaggedTemplateExpression<'_>]) -> Self {
        let candidates = tagged
            .iter()
            .map(|tagged| Candidate {
                binding: binding(&tagged.tag, semantic.scoping()),
            })
            .collect::<Vec<_>>();
        let candidate_ids = tagged
            .iter()
            .enumerate()
            .map(|(id, tagged)| (span_key(tagged.span()), id as u32))
            .collect();
        let mut index = Self {
            candidates,
            candidate_ids,
            identifiers: HashMap::new(),
            properties: HashMap::new(),
        };
        for node in semantic.nodes().iter() {
            let AstKind::VariableDeclarator(declarator) = node.kind() else {
                continue;
            };
            index.record_declarator(declarator);
        }
        index
    }

    pub(super) fn resolve(
        &self,
        expression: &Expression<'_>,
        owner: Option<&TagBinding>,
        scoping: &Scoping,
    ) -> Option<u32> {
        let id = match transparent(expression) {
            Expression::TaggedTemplateExpression(tagged) => {
                *self.candidate_ids.get(&span_key(tagged.span()))?
            }
            Expression::Identifier(identifier) => {
                let symbol = reference_symbol(identifier, scoping)?;
                *self.identifiers.get(&symbol)?
            }
            Expression::StaticMemberExpression(member) => {
                let Expression::Identifier(object) = transparent(&member.object) else {
                    return None;
                };
                let symbol = reference_symbol(object, scoping)?;
                self.properties
                    .get(&(symbol, member.property.name.to_string()))?
                    .as_ref()
                    .copied()?
            }
            _ => return None,
        };
        let candidate = self.candidates.get(id as usize)?;
        let candidate_binding = candidate.binding.as_ref()?;
        let owner_binding = owner?;
        (candidate_binding == owner_binding).then_some(id)
    }

    fn record_declarator(&mut self, declarator: &VariableDeclarator<'_>) {
        if declarator.kind != VariableDeclarationKind::Const {
            return;
        }
        let BindingPattern::BindingIdentifier(identifier) = &declarator.id else {
            return;
        };
        let Some(symbol) = identifier.symbol_id.get() else {
            return;
        };
        let Some(initializer) = declarator.init.as_ref().map(transparent) else {
            return;
        };
        if let Expression::TaggedTemplateExpression(tagged) = initializer {
            if let Some(candidate) = self.candidate_ids.get(&span_key(tagged.span())) {
                self.identifiers.insert(symbol, *candidate);
            }
            return;
        }
        let Expression::ObjectExpression(object) = initializer else {
            return;
        };
        let mut properties = HashMap::<String, Option<u32>>::new();
        let mut poison_all = false;
        for property in &object.properties {
            let ObjectPropertyKind::ObjectProperty(property) = property else {
                poison_all = true;
                continue;
            };
            if property.computed {
                poison_all = true;
                continue;
            }
            let Some(name) = property_name(&property.key) else {
                poison_all = true;
                continue;
            };
            let candidate =
                if property.kind != PropertyKind::Init || property.method || property.shorthand {
                    None
                } else if let Expression::TaggedTemplateExpression(tagged) =
                    transparent(&property.value)
                {
                    self.candidate_ids.get(&span_key(tagged.span())).copied()
                } else {
                    None
                };
            properties
                .entry(name)
                .and_modify(|existing| *existing = None)
                .or_insert(candidate);
        }
        for (name, candidate) in properties {
            self.properties
                .insert((symbol, name), (!poison_all).then_some(candidate).flatten());
        }
    }
}

fn reference_symbol(identifier: &IdentifierReference<'_>, scoping: &Scoping) -> Option<SymbolId> {
    scoping
        .get_reference(identifier.reference_id.get()?)
        .symbol_id()
}

fn property_name(key: &PropertyKey<'_>) -> Option<String> {
    match key {
        PropertyKey::StaticIdentifier(identifier) => Some(identifier.name.to_string()),
        PropertyKey::Identifier(identifier) => Some(identifier.name.to_string()),
        PropertyKey::StringLiteral(literal) if !literal.lone_surrogates => {
            Some(literal.value.as_str().to_owned())
        }
        _ => None,
    }
}

fn span_key(span: Span) -> (u32, u32) {
    (span.start, span.end)
}
