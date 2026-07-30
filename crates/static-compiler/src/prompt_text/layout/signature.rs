use crux_indexer_protocol::prompt_text::PromptTextTemplate;
use serde_json::Value;
use std::collections::BTreeMap;

/// Builds the range-free CommonMark signature frozen by the layout contract.
pub(super) fn markdown(template: &PromptTextTemplate) -> Option<Value> {
    let mut value = serde_json::json!({
        "blocks": template.blocks,
        "spans": template.spans,
        "links": template.links,
        "nesting": template.nesting,
    });
    canonicalize_node_indices(&mut value)?;
    strip_ranges(&mut value);
    Some(value)
}

fn canonicalize_node_indices(value: &mut Value) -> Option<()> {
    let root = value.as_object_mut()?;
    let mut positions = BTreeMap::<(String, u64), u64>::new();
    for (kind, field) in [("block", "blocks"), ("span", "spans"), ("link", "links")] {
        let records = root.get_mut(field)?.as_array_mut()?;
        for (position, record) in records.iter_mut().enumerate() {
            let record = record.as_object_mut()?;
            let index = record.remove("index")?.as_u64()?;
            record.remove("island")?;
            if positions
                .insert((kind.to_owned(), index), position as u64)
                .is_some()
            {
                return None;
            }
        }
    }
    for edge in root.get_mut("nesting")?.as_array_mut()? {
        let edge = edge.as_object_mut()?;
        canonicalize_node_ref(edge.get_mut("parent")?, &positions)?;
        canonicalize_node_ref(edge.get_mut("child")?, &positions)?;
    }
    Some(())
}

fn canonicalize_node_ref(
    value: &mut Value,
    positions: &BTreeMap<(String, u64), u64>,
) -> Option<()> {
    let reference = value.as_object_mut()?;
    let kind = reference.get("kind")?.as_str()?.to_owned();
    let index = reference.get("index")?.as_u64()?;
    let position = positions.get(&(kind, index))?;
    reference.insert("index".to_owned(), Value::from(*position));
    Some(())
}

fn strip_ranges(value: &mut Value) {
    match value {
        Value::Array(values) => {
            for value in values {
                strip_ranges(value);
            }
        }
        Value::Object(object) => {
            for key in [
                "range",
                "textRange",
                "markerRange",
                "markerRanges",
                "contentRange",
                "destinationRange",
            ] {
                object.remove(key);
            }
            for value in object.values_mut() {
                strip_ranges(value);
            }
        }
        _ => {}
    }
}
