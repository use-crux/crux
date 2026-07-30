use crux_indexer_syntax_oxc::prompt_text::ProjectedJsonValue;

pub(super) fn stringify(value: &ProjectedJsonValue) -> String {
    let mut output = String::new();
    write_value(value, 0, &mut output);
    output
}

fn write_value(value: &ProjectedJsonValue, depth: usize, output: &mut String) {
    match value {
        ProjectedJsonValue::Null | ProjectedJsonValue::Undefined => output.push_str("null"),
        ProjectedJsonValue::Boolean(value) => {
            output.push_str(if *value { "true" } else { "false" })
        }
        ProjectedJsonValue::String(value) => {
            output
                .push_str(&serde_json::to_string(value).expect("string serialization cannot fail"));
        }
        ProjectedJsonValue::Number(value) => output.push_str(value),
        ProjectedJsonValue::Array(values) => write_array(values, depth, output),
        ProjectedJsonValue::Object(values) => write_object(values, depth, output),
    }
}

fn write_array(values: &[ProjectedJsonValue], depth: usize, output: &mut String) {
    if values.is_empty() {
        output.push_str("[]");
        return;
    }
    output.push_str("[\n");
    for (index, value) in values.iter().enumerate() {
        indent(depth + 1, output);
        write_value(value, depth + 1, output);
        output.push_str(if index + 1 == values.len() {
            "\n"
        } else {
            ",\n"
        });
    }
    indent(depth, output);
    output.push(']');
}

fn write_object(values: &[(String, ProjectedJsonValue)], depth: usize, output: &mut String) {
    if values.is_empty() {
        output.push_str("{}");
        return;
    }
    let values = ordered_properties(values);
    output.push_str("{\n");
    for (index, (key, value)) in values.iter().enumerate() {
        indent(depth + 1, output);
        output.push_str(&serde_json::to_string(key).expect("key serialization cannot fail"));
        output.push_str(": ");
        write_value(value, depth + 1, output);
        output.push_str(if index + 1 == values.len() {
            "\n"
        } else {
            ",\n"
        });
    }
    indent(depth, output);
    output.push('}');
}

fn ordered_properties(
    values: &[(String, ProjectedJsonValue)],
) -> Vec<&(String, ProjectedJsonValue)> {
    let mut indexes = values
        .iter()
        .filter_map(|value| array_index(&value.0).map(|index| (index, value)))
        .collect::<Vec<_>>();
    indexes.sort_by_key(|(index, _)| *index);
    indexes
        .into_iter()
        .map(|(_, value)| value)
        .chain(
            values
                .iter()
                .filter(|value| array_index(&value.0).is_none()),
        )
        .collect()
}

fn array_index(value: &str) -> Option<u32> {
    if value.is_empty() || value.len() > 10 || value.starts_with('0') && value != "0" {
        return None;
    }
    let index = value.parse::<u32>().ok()?;
    (index != u32::MAX && index.to_string() == value).then_some(index)
}

fn indent(depth: usize, output: &mut String) {
    output.extend(std::iter::repeat_n(' ', depth * 2));
}
