use serde_json::json;

use crate::{
    projection::project_native_facts,
    protocol::{
        LiteralValue, SourceLocation, StaticCalleeRecord, StaticObjectProperty, StaticSourceMatch,
        StaticSyntaxValue,
    },
};

const FILE: &str = "/repo/src/prompt.ts";

#[test]
fn inline_tagged_system_and_prompt_values_do_not_synthesize_owner_refs() {
    let config = StaticSyntaxValue::Object {
        properties: vec![
            property(
                "id",
                StaticSyntaxValue::Literal {
                    value: LiteralValue::String("writer".to_string()),
                },
            ),
            property("system", tagged_value(3, 50)),
            property("prompt", tagged_value(3, 72)),
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
        local_initializers: Vec::new(),
    }];

    let projections = project_native_facts(FILE, "", &[], &[], &matches);
    let source_refs = projections
        .first()
        .expect("prompt should project native facts")
        .facts
        .get("sourceRefs")
        .expect("prompt facts should include source refs");

    assert_eq!(source_refs, &json!([]));
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

fn tagged_value(line: usize, column: usize) -> StaticSyntaxValue {
    StaticSyntaxValue::TaggedTemplate {
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
        source: location(line, column),
        snippet: None,
    }
}

fn location(line: usize, column: usize) -> SourceLocation {
    SourceLocation {
        file: FILE.to_string(),
        line,
        column,
    }
}
