package evalfs

import (
	"bytes"
	"encoding/json"
	"fmt"
	"math"
)

func contractError(path, message string) error {
	return fmt.Errorf("%s: %s", path, message)
}

func decodeContract(raw []byte, path string, target any) error {
	if len(raw) == 0 || bytes.Equal(bytes.TrimSpace(raw), []byte("null")) {
		return contractError(path, "is required")
	}
	if err := json.Unmarshal(raw, target); err != nil {
		return contractError(path, err.Error())
	}
	return nil
}

func oneOf(value string, allowed ...string) bool {
	for _, candidate := range allowed {
		if value == candidate {
			return true
		}
	}
	return false
}

func validNonnegative(value float64) bool {
	return !math.IsNaN(value) && !math.IsInf(value, 0) && value >= 0
}

func rawNumberOrBoolean(raw json.RawMessage) bool {
	var boolean bool
	if json.Unmarshal(raw, &boolean) == nil {
		return true
	}
	var number float64
	return json.Unmarshal(raw, &number) == nil && !math.IsNaN(number) && !math.IsInf(number, 0)
}

func rawNullableScore(raw json.RawMessage) bool {
	if len(raw) == 0 {
		return false
	}
	if bytes.Equal(bytes.TrimSpace(raw), []byte("null")) {
		return true
	}
	var value float64
	return json.Unmarshal(raw, &value) == nil && value >= 0 && value <= 1
}

func rawObject(raw json.RawMessage) bool {
	if len(raw) == 0 {
		return true
	}
	var value map[string]json.RawMessage
	return json.Unmarshal(raw, &value) == nil && value != nil
}
