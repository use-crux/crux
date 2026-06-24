package server

import (
	"encoding/json"
	"fmt"
	"strconv"
)

type projectIndexerWorkerSyntaxBatchEventRawFields struct {
	id      json.RawMessage
	typ     json.RawMessage
	index   json.RawMessage
	count   json.RawMessage
	record  json.RawMessage
	message json.RawMessage
}

func decodeProjectIndexerWorkerSyntaxBatchEvent(raw json.RawMessage) (projectIndexerWorkerSyntaxBatchEvent, error) {
	fields, err := projectIndexerWorkerSyntaxBatchEventFields(raw)
	if err != nil {
		return projectIndexerWorkerSyntaxBatchEvent{}, err
	}
	eventType, err := decodeJSONStringField(fields.typ, "type")
	if err != nil {
		return projectIndexerWorkerSyntaxBatchEvent{}, err
	}
	id, err := decodeJSONUintField(fields.id, "id")
	if err != nil {
		return projectIndexerWorkerSyntaxBatchEvent{}, err
	}
	event := projectIndexerWorkerSyntaxBatchEvent{ID: id, Type: eventType}
	switch eventType {
	case "record":
		index, err := decodeJSONIntField(fields.index, "index")
		if err != nil {
			return projectIndexerWorkerSyntaxBatchEvent{}, err
		}
		if len(fields.record) == 0 {
			return projectIndexerWorkerSyntaxBatchEvent{}, fmt.Errorf("project indexer worker syntax stream event missing record")
		}
		event.Index = index
		event.Record = fields.record
	case "done":
		count, err := decodeJSONIntField(fields.count, "count")
		if err != nil {
			return projectIndexerWorkerSyntaxBatchEvent{}, err
		}
		event.Count = count
	case "error":
		if len(fields.message) > 0 {
			message, err := decodeJSONStringField(fields.message, "error")
			if err != nil {
				return projectIndexerWorkerSyntaxBatchEvent{}, err
			}
			event.Error = message
		}
	}
	return event, nil
}

func projectIndexerWorkerSyntaxBatchEventFields(raw []byte) (projectIndexerWorkerSyntaxBatchEventRawFields, error) {
	var fields projectIndexerWorkerSyntaxBatchEventRawFields
	index := skipJSONWhitespace(raw, 0)
	if index >= len(raw) || raw[index] != '{' {
		return fields, fmt.Errorf("project indexer worker syntax stream event must be a JSON object")
	}
	index++
	for {
		index = skipJSONWhitespace(raw, index)
		if index >= len(raw) {
			return fields, fmt.Errorf("unterminated project indexer worker syntax stream event")
		}
		if raw[index] == '}' {
			return fields, nil
		}
		keyStart := index
		keyEnd, err := scanJSONString(raw, index)
		if err != nil {
			return fields, err
		}
		key, err := strconv.Unquote(string(raw[keyStart:keyEnd]))
		if err != nil {
			return fields, fmt.Errorf("decode project indexer worker syntax stream event key: %w", err)
		}
		index = skipJSONWhitespace(raw, keyEnd)
		if index >= len(raw) || raw[index] != ':' {
			return fields, fmt.Errorf("project indexer worker syntax stream event field %q missing colon", key)
		}
		valueStart := skipJSONWhitespace(raw, index+1)
		valueEnd, err := scanProjectIndexerWorkerSyntaxEventFieldValue(raw, valueStart, key)
		if err != nil {
			return fields, fmt.Errorf("scan project indexer worker syntax stream event field %q: %w", key, err)
		}
		value := json.RawMessage(raw[valueStart:valueEnd])
		switch key {
		case "id":
			fields.id = value
		case "type":
			fields.typ = value
		case "index":
			fields.index = value
		case "count":
			fields.count = value
		case "record":
			fields.record = value
		case "error":
			fields.message = value
		}
		index = skipJSONWhitespace(raw, valueEnd)
		if index >= len(raw) {
			return fields, fmt.Errorf("unterminated project indexer worker syntax stream event")
		}
		switch raw[index] {
		case ',':
			index++
		case '}':
			return fields, nil
		default:
			return fields, fmt.Errorf("project indexer worker syntax stream event field %q has invalid delimiter %q", key, raw[index])
		}
	}
}

func scanProjectIndexerWorkerSyntaxEventFieldValue(raw []byte, index int, key string) (int, error) {
	if key == "record" {
		// Rust worker record events serialize `record` as the final field. Slice
		// that value directly so Go does not scan and copy the full syntax record.
		if end, ok := finalProjectIndexerWorkerSyntaxRecordFieldEnd(raw, index); ok {
			return end, nil
		}
	}
	return scanJSONValue(raw, index)
}

func finalProjectIndexerWorkerSyntaxRecordFieldEnd(raw []byte, index int) (int, bool) {
	index = skipJSONWhitespace(raw, index)
	if index >= len(raw) || raw[index] != '{' {
		return 0, false
	}
	end := len(raw)
	for end > index {
		switch raw[end-1] {
		case ' ', '\n', '\r', '\t':
			end--
		default:
			goto foundEnd
		}
	}
foundEnd:
	if end <= index || raw[end-1] != '}' {
		return 0, false
	}
	return end - 1, true
}

func decodeJSONUintField(raw json.RawMessage, name string) (uint64, error) {
	if len(raw) == 0 {
		return 0, fmt.Errorf("project indexer worker syntax stream event missing %s", name)
	}
	var value uint64
	if err := json.Unmarshal(raw, &value); err != nil {
		return 0, fmt.Errorf("decode project indexer worker syntax stream event %s: %w", name, err)
	}
	return value, nil
}

func decodeJSONIntField(raw json.RawMessage, name string) (int, error) {
	if len(raw) == 0 {
		return 0, fmt.Errorf("project indexer worker syntax stream event missing %s", name)
	}
	var value int
	if err := json.Unmarshal(raw, &value); err != nil {
		return 0, fmt.Errorf("decode project indexer worker syntax stream event %s: %w", name, err)
	}
	return value, nil
}

func decodeJSONStringField(raw json.RawMessage, name string) (string, error) {
	if len(raw) == 0 {
		return "", fmt.Errorf("project indexer worker syntax stream event missing %s", name)
	}
	var value string
	if err := json.Unmarshal(raw, &value); err != nil {
		return "", fmt.Errorf("decode project indexer worker syntax stream event %s: %w", name, err)
	}
	return value, nil
}

func scanJSONValue(raw []byte, index int) (int, error) {
	index = skipJSONWhitespace(raw, index)
	if index >= len(raw) {
		return 0, fmt.Errorf("missing JSON value")
	}
	switch raw[index] {
	case '"':
		return scanJSONString(raw, index)
	case '{', '[':
		return scanJSONComposite(raw, index)
	default:
		return scanJSONPrimitive(raw, index)
	}
}

func scanJSONComposite(raw []byte, index int) (int, error) {
	stack := []byte{matchingJSONClose(raw[index])}
	index++
	for index < len(raw) {
		switch raw[index] {
		case '"':
			next, err := scanJSONString(raw, index)
			if err != nil {
				return 0, err
			}
			index = next
		case '{', '[':
			stack = append(stack, matchingJSONClose(raw[index]))
			index++
		case '}', ']':
			if len(stack) == 0 || raw[index] != stack[len(stack)-1] {
				return 0, fmt.Errorf("mismatched JSON delimiter %q", raw[index])
			}
			stack = stack[:len(stack)-1]
			index++
			if len(stack) == 0 {
				return index, nil
			}
		default:
			index++
		}
	}
	return 0, fmt.Errorf("unterminated JSON composite value")
}

func scanJSONPrimitive(raw []byte, index int) (int, error) {
	start := index
	for index < len(raw) {
		switch raw[index] {
		case ',', '}', ']', ' ', '\n', '\r', '\t':
			if index == start {
				return 0, fmt.Errorf("empty JSON primitive value")
			}
			return index, nil
		default:
			index++
		}
	}
	if index == start {
		return 0, fmt.Errorf("empty JSON primitive value")
	}
	return index, nil
}

func scanJSONString(raw []byte, index int) (int, error) {
	if index >= len(raw) || raw[index] != '"' {
		return 0, fmt.Errorf("expected JSON string")
	}
	index++
	for index < len(raw) {
		switch raw[index] {
		case '\\':
			index += 2
		case '"':
			return index + 1, nil
		default:
			if raw[index] < 0x20 {
				return 0, fmt.Errorf("invalid control character in JSON string")
			}
			index++
		}
	}
	return 0, fmt.Errorf("unterminated JSON string")
}

func matchingJSONClose(open byte) byte {
	if open == '[' {
		return ']'
	}
	return '}'
}

func skipJSONWhitespace(raw []byte, index int) int {
	for index < len(raw) {
		switch raw[index] {
		case ' ', '\n', '\r', '\t':
			index++
		default:
			return index
		}
	}
	return index
}
