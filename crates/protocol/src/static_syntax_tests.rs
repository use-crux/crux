use serde_json::json;

use crate::StaticSyntaxValue;

#[test]
fn tagged_template_value_round_trips_through_the_json_abi() {
    let expected = json!({
        "kind": "tagged-template",
        "tag": {
            "name": "md",
            "direct": true,
            "localName": "promptText",
            "importedName": "md",
            "moduleSpecifier": "@use-crux/core"
        },
        "text": "`Hello ${name}`",
        "expressions": [{
            "value": { "kind": "identifier", "name": "name" },
            "source": {
                "file": "/repo/src/prompt.ts",
                "line": 3,
                "column": 32
            }
        }],
        "source": {
            "file": "/repo/src/prompt.ts",
            "line": 3,
            "column": 14
        },
        "snippet": {
            "source": "promptText`Hello ${name}`",
            "language": "typescript",
            "range": {
                "file": "/repo/src/prompt.ts",
                "startLine": 3,
                "startColumn": 14,
                "endLine": 3,
                "endColumn": 39
            },
            "truncated": false
        }
    });

    let value: StaticSyntaxValue =
        serde_json::from_value(expected.clone()).expect("tagged-template ABI should deserialize");

    assert_eq!(
        serde_json::to_value(value).expect("tagged-template ABI should serialize"),
        expected
    );
}
