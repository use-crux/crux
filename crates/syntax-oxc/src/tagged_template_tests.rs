use crux_indexer_protocol::{ParseRequest, StaticSyntaxFileRecord};
use serde_json::{Value, json};

use crate::parse_source;

const FILE: &str = "/repo/src/tagged.ts";

#[test]
fn records_tagged_templates_with_canonical_callees_and_exact_ranges() {
    let record = tagged_template_record();

    assert_eq!(
        initializer_value(&record, "direct"),
        json!({
            "kind": "tagged-template",
            "tag": imported_tag("md"),
            "text": "`x${value}`",
            "expressions": [{
                "value": { "kind": "identifier", "name": "value" },
                "source": source(4, 22)
            }],
            "source": source(4, 16),
            "snippet": snippet("md`x${value}`", 4, 16, 29)
        })
    );
    assert_eq!(
        initializer_value(&record, "alias"),
        json!({
            "kind": "tagged-template",
            "tag": imported_alias_tag(),
            "text": "`y${value}`",
            "expressions": [{
                "value": { "kind": "identifier", "name": "value" },
                "source": source(5, 23)
            }],
            "source": source(5, 15),
            "snippet": snippet("text`y${value}`", 5, 15, 30)
        })
    );
    assert_eq!(
        initializer_value(&record, "namespace"),
        json!({
            "kind": "tagged-template",
            "tag": namespace_tag(),
            "text": "`z${value}`",
            "expressions": [{
                "value": { "kind": "identifier", "name": "value" },
                "source": source(6, 30)
            }],
            "source": source(6, 19),
            "snippet": snippet("crux.md`z${value}`", 6, 19, 37)
        })
    );
}

#[test]
fn records_nested_and_unrelated_tags_without_assigning_semantic_meaning() {
    let record = tagged_template_record();

    assert_eq!(
        initializer_value(&record, "nested"),
        json!({
            "kind": "tagged-template",
            "tag": imported_tag("md"),
            "text": "`o${text`i${value}`}`",
            "expressions": [{
                "value": {
                    "kind": "tagged-template",
                    "tag": imported_alias_tag(),
                    "text": "`i${value}`",
                    "expressions": [{
                        "value": { "kind": "identifier", "name": "value" },
                        "source": source(7, 30)
                    }],
                    "source": source(7, 22),
                    "snippet": snippet("text`i${value}`", 7, 22, 37)
                },
                "source": source(7, 22)
            }],
            "source": source(7, 16),
            "snippet": snippet("md`o${text`i${value}`}`", 7, 16, 39)
        })
    );
    assert_eq!(
        initializer_value(&record, "unrelated"),
        json!({
            "kind": "tagged-template",
            "tag": {
                "name": "html",
                "direct": true,
                "localName": "html"
            },
            "text": "`u${value}`",
            "expressions": [{
                "value": { "kind": "identifier", "name": "value" },
                "source": source(8, 27)
            }],
            "source": source(8, 19),
            "snippet": snippet("html`u${value}`", 8, 19, 34)
        })
    );

    assert!(
        serde_json::to_string(&record)
            .expect("syntax record should serialize")
            .find("promptText")
            .is_none(),
        "the static syntax frontend must not assign semantic prompt-text meaning"
    );
}

#[test]
fn records_tagged_templates_inside_prompt_fields_and_callback_returns() {
    let record = parse_source(ParseRequest {
        root: "/repo".to_string(),
        file: FILE.to_string(),
        source: [
            "import { md as text, prompt } from '@use-crux/core'",
            "const value = 'Ada'",
            "const named = text`named ${value}`",
            "export const writer = prompt({",
            "  system: text`inline ${value}`,",
            "  prompt: named,",
            "})",
            "export const dynamic = prompt({",
            "  prompt: () => text`dynamic ${value}`,",
            "})",
        ]
        .join("\n"),
        call_names: vec!["prompt".to_string()],
        call_interests: Vec::new(),
        constructor_names: Vec::new(),
        constructor_interests: Vec::new(),
        prune_native_fact_call_names: Vec::new(),
    })
    .expect("prompt tagged-template fixture should parse");

    let serialized = serde_json::to_value(&record).expect("syntax record should serialize");
    assert_eq!(
        serialized["localInitializers"][1]["value"],
        json!({
            "kind": "tagged-template",
            "tag": imported_alias_tag(),
            "text": "`named ${value}`",
            "expressions": [{
                "value": { "kind": "identifier", "name": "value" },
                "source": source(3, 28)
            }],
            "source": source(3, 15),
            "snippet": snippet("text`named ${value}`", 3, 15, 35)
        })
    );
    assert_eq!(
        serialized["matches"][0]["objectArg"]["properties"][0]["value"]["source"],
        source(5, 11)
    );
    assert_eq!(
        serialized["matches"][1]["objectArg"]["properties"][0]["value"]["returns"][0],
        json!({
            "kind": "tagged-template",
            "tag": imported_alias_tag(),
            "text": "`dynamic ${value}`",
            "expressions": [{
                "value": { "kind": "identifier", "name": "value" },
                "source": source(9, 32)
            }],
            "source": source(9, 17),
            "snippet": snippet("text`dynamic ${value}`", 9, 17, 39)
        })
    );
}

#[test]
fn retains_a_tagged_template_when_the_tag_expression_is_unsupported() {
    let record = parse_source(ParseRequest {
        root: "/repo".to_string(),
        file: FILE.to_string(),
        source: [
            "const value = 'Ada'",
            "const computed = (choose ? md : html)`c${value}`",
        ]
        .join("\n"),
        call_names: Vec::new(),
        call_interests: Vec::new(),
        constructor_names: Vec::new(),
        constructor_interests: Vec::new(),
        prune_native_fact_call_names: Vec::new(),
    })
    .expect("unsupported tag expression fixture should parse");

    assert_eq!(
        initializer_value(&record, "computed"),
        json!({
            "kind": "tagged-template",
            "tag": { "name": "<unknown>", "direct": false },
            "text": "`c${value}`",
            "expressions": [{
                "value": { "kind": "identifier", "name": "value" },
                "source": source(2, 42)
            }],
            "source": source(2, 18),
            "snippet": snippet("(choose ? md : html)`c${value}`", 2, 18, 49)
        })
    );
}

fn tagged_template_record() -> StaticSyntaxFileRecord {
    parse_source(ParseRequest {
        root: "/repo".to_string(),
        file: FILE.to_string(),
        source: [
            "import { md, md as text } from '@use-crux/core'",
            "import * as crux from '@use-crux/core'",
            "const value = 'Ada'",
            "const direct = md`x${value}`",
            "const alias = text`y${value}`",
            "const namespace = crux.md`z${value}`",
            "const nested = md`o${text`i${value}`}`",
            "const unrelated = html`u${value}`",
        ]
        .join("\n"),
        call_names: Vec::new(),
        call_interests: Vec::new(),
        constructor_names: Vec::new(),
        constructor_interests: Vec::new(),
        prune_native_fact_call_names: Vec::new(),
    })
    .expect("tagged-template fixture should parse")
}

fn initializer_value(record: &StaticSyntaxFileRecord, name: &str) -> Value {
    let value = &record
        .local_initializers
        .iter()
        .find(|initializer| initializer.name == name)
        .unwrap_or_else(|| panic!("missing {name} initializer"))
        .value;
    serde_json::to_value(value).expect("syntax value should serialize")
}

fn imported_tag(local_name: &str) -> Value {
    json!({
        "name": "md",
        "direct": true,
        "localName": local_name,
        "importedName": "md",
        "moduleSpecifier": "@use-crux/core"
    })
}

fn imported_alias_tag() -> Value {
    imported_tag("text")
}

fn namespace_tag() -> Value {
    json!({
        "name": "md",
        "direct": false,
        "localName": "crux",
        "receiverName": "crux",
        "importedName": "md",
        "moduleSpecifier": "@use-crux/core"
    })
}

fn source(line: usize, column: usize) -> Value {
    json!({ "file": FILE, "line": line, "column": column })
}

fn snippet(text: &str, line: usize, start_column: usize, end_column: usize) -> Value {
    json!({
        "source": text,
        "language": "typescript",
        "range": {
            "file": FILE,
            "startLine": line,
            "startColumn": start_column,
            "endLine": line,
            "endColumn": end_column
        },
        "truncated": false
    })
}
