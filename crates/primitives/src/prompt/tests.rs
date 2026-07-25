use serde_json::json;

use crate::{
    projection::project_native_facts,
    protocol::{
        LiteralValue, SourceLocation, SourceRange, SourceSnippet, StaticCalleeRecord,
        StaticInitializerRecord, StaticObjectProperty, StaticSourceMatch, StaticSyntaxValue,
    },
};

mod inline;

const FILE: &str = "/repo/src/prompt.ts";

#[test]
fn direct_prompt_text_gets_the_same_owning_ref_coverage_as_system_text() {
    let authored = tagged_initializer();
    let config = StaticSyntaxValue::Object {
        properties: vec![
            property(
                "id",
                StaticSyntaxValue::Literal {
                    value: LiteralValue::String("writer".to_string()),
                },
            ),
            property(
                "system",
                StaticSyntaxValue::Identifier {
                    name: "authored".to_string(),
                },
            ),
            property(
                "prompt",
                StaticSyntaxValue::Identifier {
                    name: "authored".to_string(),
                },
            ),
        ],
        source: location(3, 37),
        snippet: None,
    };
    let matches = vec![StaticSourceMatch::Call {
        variable_name: "writer".to_string(),
        owner_variable_name: None,
        local_name: "src/prompt.ts:writer".to_string(),
        exported: true,
        eager_execution: true,
        callee: StaticCalleeRecord {
            name: "prompt".to_string(),
            direct: Some(true),
            local_name: Some("prompt".to_string()),
            receiver_name: None,
            imported_name: Some("prompt".to_string()),
            module_specifier: Some("@use-crux/core".to_string()),
            resolved_file: None,
        },
        args: vec![config.clone()],
        object_arg: Some(config),
        source: location(3, 23),
        snippet: None,
        local_initializers: vec![authored.clone()],
    }];

    let projections = project_native_facts(FILE, "", &[], &[authored], &matches);
    let source_refs = projections
        .first()
        .expect("prompt should project native facts")
        .facts
        .get("sourceRefs")
        .expect("prompt facts should include source refs");

    assert_eq!(
        source_refs,
        &json!([
            source_ref("prompt", None),
            source_ref("system", Some(json!({ "fragment": true })))
        ])
    );
    assert!(
        serde_json::to_string(source_refs)
            .expect("source refs should serialize")
            .find("promptText")
            .is_none(),
        "static facts must not claim semantic prompt-text identity"
    );
}

#[test]
fn property_access_prompt_text_uses_the_tagged_value_source_and_snippet() {
    let fragment = StaticInitializerRecord {
        name: "fragments".to_string(),
        value: StaticSyntaxValue::Object {
            properties: vec![StaticObjectProperty {
                name: "answer".to_string(),
                value: StaticSyntaxValue::TaggedTemplate {
                    tag: StaticCalleeRecord {
                        name: "md".to_string(),
                        direct: Some(true),
                        local_name: Some("md".to_string()),
                        receiver_name: None,
                        imported_name: Some("md".to_string()),
                        module_specifier: Some("@use-crux/core".to_string()),
                        resolved_file: None,
                    },
                    text: "`Answer`".to_string(),
                    expressions: Vec::new(),
                    source: location(2, 29),
                    snippet: Some(tagged_snippet_at(2, 29)),
                },
                shorthand: false,
                spread: None,
                source: location(2, 21),
            }],
            source: location(2, 19),
            snippet: None,
        },
        source: location(2, 19),
        snippet: None,
    };
    let config = StaticSyntaxValue::Object {
        properties: vec![
            property(
                "id",
                StaticSyntaxValue::Literal {
                    value: LiteralValue::String("writer".to_string()),
                },
            ),
            property(
                "prompt",
                StaticSyntaxValue::PropertyAccess {
                    name: "answer".to_string(),
                    path: vec!["fragments".to_string(), "answer".to_string()],
                },
            ),
        ],
        source: location(3, 37),
        snippet: None,
    };
    let matches = vec![StaticSourceMatch::Call {
        variable_name: "writer".to_string(),
        owner_variable_name: None,
        local_name: "src/prompt.ts:writer".to_string(),
        exported: true,
        eager_execution: true,
        callee: StaticCalleeRecord {
            name: "prompt".to_string(),
            direct: Some(true),
            local_name: Some("prompt".to_string()),
            receiver_name: None,
            imported_name: Some("prompt".to_string()),
            module_specifier: Some("@use-crux/core".to_string()),
            resolved_file: None,
        },
        args: vec![config.clone()],
        object_arg: Some(config),
        source: location(3, 23),
        snippet: None,
        local_initializers: vec![fragment.clone()],
    }];

    let projections = project_native_facts(FILE, "", &[], &[fragment], &matches);
    let source_refs = projections
        .first()
        .expect("prompt should project native facts")
        .facts
        .get("sourceRefs")
        .expect("prompt facts should include source refs");

    assert_eq!(
        source_refs,
        &json!([{
            "definitionId": "prompt:writer",
            "ref": {
                "id": "prompt:writer:source:prompt:prompt:fragments.answer",
                "role": "prompt",
                "property": "prompt",
                "symbol": "fragments.answer",
                "source": location(2, 29),
                "snippet": tagged_snippet_at(2, 29),
                "fidelity": "resolved"
            }
        }])
    );
}

fn tagged_initializer() -> StaticInitializerRecord {
    StaticInitializerRecord {
        name: "authored".to_string(),
        value: StaticSyntaxValue::TaggedTemplate {
            tag: StaticCalleeRecord {
                name: "md".to_string(),
                direct: Some(true),
                local_name: Some("md".to_string()),
                receiver_name: None,
                imported_name: Some("md".to_string()),
                module_specifier: Some("@use-crux/core".to_string()),
                resolved_file: None,
            },
            text: "`Answer`".to_string(),
            expressions: Vec::new(),
            source: location(2, 18),
            snippet: Some(tagged_snippet()),
        },
        source: location(2, 18),
        snippet: Some(tagged_snippet()),
    }
}

fn property(name: &str, value: StaticSyntaxValue) -> StaticObjectProperty {
    StaticObjectProperty {
        name: name.to_string(),
        value,
        shorthand: false,
        spread: None,
        source: location(3, 37),
    }
}

fn source_ref(role: &str, metadata: Option<serde_json::Value>) -> serde_json::Value {
    let mut reference = json!({
        "definitionId": "prompt:writer",
        "ref": {
            "id": format!("prompt:writer:source:{role}:{role}:authored"),
            "role": role,
            "property": role,
            "symbol": "authored",
            "source": location(2, 18),
            "snippet": tagged_snippet(),
            "fidelity": "resolved"
        }
    });
    if let Some(metadata) = metadata {
        reference["ref"]["metadata"] = metadata;
    }
    reference
}

fn location(line: usize, column: usize) -> SourceLocation {
    SourceLocation {
        file: FILE.to_string(),
        line,
        column,
    }
}

fn tagged_snippet() -> SourceSnippet {
    SourceSnippet {
        source: "md`Answer`".to_string(),
        language: "typescript".to_string(),
        range: SourceRange {
            file: FILE.to_string(),
            start_line: 2,
            start_column: 18,
            end_line: 2,
            end_column: 28,
        },
        truncated: false,
    }
}

fn tagged_snippet_at(line: usize, start_column: usize) -> SourceSnippet {
    SourceSnippet {
        source: "md`Answer`".to_string(),
        language: "typescript".to_string(),
        range: SourceRange {
            file: FILE.to_string(),
            start_line: line,
            start_column,
            end_line: line,
            end_column: start_column + 10,
        },
        truncated: false,
    }
}
