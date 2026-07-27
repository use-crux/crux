use super::super::{analyze, request};

#[test]
fn preview_json_matches_javascript_key_order_boundaries_and_escaping() {
    let source = concat!(
        "const value = md`${md.json(({",
        "\"4294967295\": \"non-index\",",
        "\"2\": \"old\",",
        "\"4294967294\": \"edge\",",
        "\"01\": \"leading\",",
        "3: \"three\",",
        "\"2\": \"two\",",
        "escaped: \"line\\n\\\"quote\\\"\\\\slash\",",
        "} as const))}`;",
    );
    let preview = &analyze(request(source)).templates[0].preview;

    assert_eq!(
        preview.text,
        concat!(
            "{\n",
            "  \"2\": \"two\",\n",
            "  \"3\": \"three\",\n",
            "  \"4294967294\": \"edge\",\n",
            "  \"4294967295\": \"non-index\",\n",
            "  \"01\": \"leading\",\n",
            "  \"escaped\": \"line\\n\\\"quote\\\"\\\\slash\"\n",
            "}",
        ),
    );
}

#[test]
fn preview_json_rejects_every_executable_or_ambiguous_shape() {
    let cases = [
        ("const alias = { ok: true };", "alias"),
        ("const value = 1;", "{ value }"),
        ("const key = 'value';", "{ [key]: 1 }"),
        ("", "{ ...other }"),
        ("", "[...other]"),
        ("", "{ method() {} }"),
        ("", "{ get value() { return 1 } }"),
        ("", "call()"),
        ("", "new Date()"),
        ("", "other`value`"),
        ("", "1n"),
        ("", "{ \"\\uD800\": 1 }"),
        ("", "\"\\uD800\""),
        ("", "{ __proto__: null }"),
        ("", "undefined"),
        ("const undefined = 'shadowed';", "{ value: undefined }"),
    ];
    for (prefix, argument) in cases {
        let source = format!("{prefix}\nconst root = md`${{md.json({argument})}}`;");
        let response = analyze(request(&source));
        let preview = &response.templates.first().expect("root template").preview;
        assert_eq!(preview.text, "⟪unknown⟫", "unsafe JSON argument {argument}",);
    }

    for call in ["md.json()", "md.json(1, 2)", "md[\"json\"]({ ok: true })"] {
        let source = format!("const root = md`${{{call}}}`;");
        assert_eq!(
            analyze(request(&source)).templates[0].preview.text,
            "⟪unknown⟫",
            "unsafe JSON call {call}",
        );
    }
}
