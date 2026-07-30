use super::super::{analyze, request};

#[test]
fn preview_projects_only_closed_direct_lexical_values() {
    let source = concat!(
        "const undefined = \"shadowed\";\n",
        "const scalar = \"alias\";\n",
        "const value = md`",
        "${(\"x\" as const)}|${<const>2}|${(false satisfies boolean)}|",
        "${(`a\nb`!)}|${undefined}|${scalar}|${true}|${1n}",
        "`;\n",
    );
    let response = analyze(request(source));
    let preview = &response.templates.last().expect("root template").preview;

    assert_eq!(
        preview.text,
        concat!("x|2||a\nb|", "⟪unknown⟫|⟪unknown⟫|⟪unknown⟫|⟪unknown⟫",),
    );
    assert!(!preview.text.contains("shadowed"));
    assert!(!preview.text.contains("alias"));
}

#[test]
fn preview_does_not_follow_fragment_aliases_or_mutable_and_ambiguous_properties() {
    let source = concat!(
        "const direct = md`Direct`;\n",
        "const alias = direct;\n",
        "let mutable = md`Mutable`;\n",
        "const catalogue = {",
        "note: md`First`, note: md`Second`, [\"computed\"]: md`Computed`",
        "};\n",
        "const root = md`",
        "${direct}|${alias}|${mutable}|${catalogue.note}|${catalogue.computed}",
        "`;\n",
    );
    let response = analyze(request(source));
    let preview = &response.templates.last().expect("root template").preview;

    assert_eq!(
        preview.text,
        "Direct|⟪unknown⟫|⟪unknown⟫|⟪unknown⟫|⟪unknown⟫",
    );
}

#[test]
fn preview_rejects_object_fragments_shadowed_by_nonfragments_or_spreads() {
    let source = concat!(
        "const key = \"note\";\n",
        "const duplicate = { note: md`Private`, note: getValue() };\n",
        "const spread = { note: md`Private`, ...getCatalogue() };\n",
        "const computed = { note: md`Private`, [key]: getValue() };\n",
        "const root = md`",
        "${duplicate.note}|${spread.note}|${computed.note}",
        "`;\n",
    );
    let response = analyze(request(source));
    let preview = &response.templates.last().expect("root template").preview;

    assert_eq!(preview.text, "⟪unknown⟫|⟪unknown⟫|⟪unknown⟫",);
    assert!(!preview.text.contains("Private"));
}

#[test]
fn preview_treats_an_empty_inline_array_as_one_private_placeholder() {
    let preview = &analyze(request("const value = md`before ${[]} after`;")).templates[0].preview;

    assert_eq!(preview.text, "before ⟪unknown⟫ after");
}
