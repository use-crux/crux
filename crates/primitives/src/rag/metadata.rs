use serde_json::{Map, Value, json};

pub(crate) fn dependency_metadata(retrievers: &[String], scorers: &[String]) -> Value {
    let mut dependencies = Map::new();
    if !retrievers.is_empty() {
        dependencies.insert("retrievers".to_string(), json!(retrievers));
    }
    if !scorers.is_empty() {
        dependencies.insert("scorers".to_string(), json!(scorers));
    }
    Value::Object(dependencies)
}

pub(crate) fn unique_defined<'a>(values: impl Iterator<Item = &'a str>) -> Vec<String> {
    let mut output = Vec::new();
    for value in values {
        if !output.iter().any(|item| item == value) {
            output.push(value.to_string());
        }
    }
    output
}
