package observability

import (
	"encoding/json"
)

func stringAttribute(raw json.RawMessage, key string) string {
	if len(raw) == 0 {
		return ""
	}
	var attrs map[string]any
	if err := json.Unmarshal(raw, &attrs); err != nil {
		return ""
	}
	value, ok := attrs[key]
	if !ok {
		return ""
	}
	text, ok := value.(string)
	if !ok {
		return ""
	}
	return text
}

func numericAttribute(raw json.RawMessage, key string) (float64, bool) {
	if len(raw) == 0 {
		return 0, false
	}
	var attrs map[string]any
	if err := json.Unmarshal(raw, &attrs); err != nil {
		return 0, false
	}
	value, ok := attrs[key]
	if !ok {
		return 0, false
	}
	number, ok := value.(float64)
	return number, ok
}

func nullIfEmpty(value string) interface{} {
	if value == "" {
		return nil
	}
	return value
}

func nullJSON(value json.RawMessage) interface{} {
	if len(value) == 0 {
		return nil
	}
	return string(value)
}

func nullInt64(value int64) interface{} {
	if value == 0 {
		return nil
	}
	return value
}

func nullFloat64(value float64) interface{} {
	if value == 0 {
		return nil
	}
	return value
}
