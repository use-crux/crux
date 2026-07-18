package evalfs

import (
	"bytes"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"math"
	"sort"
	"unicode/utf16"
)

// fingerprintJSONValue mirrors Core's tagged canonical fingerprint encoding
// for the JSON value domain persisted in Eval artifacts.
func fingerprintJSONValue(value any) (string, error) {
	encoded, err := encodeFingerprintValue(value)
	if err != nil {
		return "", err
	}
	var canonical bytes.Buffer
	encoder := json.NewEncoder(&canonical)
	encoder.SetEscapeHTML(false)
	if err := encoder.Encode(encoded); err != nil {
		return "", err
	}
	digest := sha256.Sum256(bytes.TrimSuffix(canonical.Bytes(), []byte("\n")))
	return fmt.Sprintf("%x", digest), nil
}

func encodeFingerprintValue(value any) (any, error) {
	switch typed := value.(type) {
	case nil:
		return []any{"null"}, nil
	case string:
		return []any{"string", typed}, nil
	case bool:
		return []any{"boolean", typed}, nil
	case float64:
		if math.Signbit(typed) && typed == 0 {
			return []any{"number", "-0"}, nil
		}
		return []any{"number", typed}, nil
	case []any:
		entries := make([]any, len(typed))
		for index, entry := range typed {
			encoded, err := encodeFingerprintValue(entry)
			if err != nil {
				return nil, err
			}
			entries[index] = encoded
		}
		return []any{"array", entries, []any{}}, nil
	case map[string]any:
		keys := make([]string, 0, len(typed))
		for key := range typed {
			keys = append(keys, key)
		}
		sort.Slice(keys, func(i, j int) bool {
			return fingerprintUTF16Less(keys[i], keys[j])
		})
		entries := make([]any, 0, len(keys))
		for _, key := range keys {
			encoded, err := encodeFingerprintValue(typed[key])
			if err != nil {
				return nil, err
			}
			entries = append(entries, []any{key, encoded})
		}
		return []any{"object", entries}, nil
	default:
		return nil, fmt.Errorf("unsupported fingerprint value %T", value)
	}
}

func fingerprintUTF16Less(left, right string) bool {
	a := utf16.Encode([]rune(left))
	b := utf16.Encode([]rune(right))
	for index := 0; index < len(a) && index < len(b); index++ {
		if a[index] != b[index] {
			return a[index] < b[index]
		}
	}
	return len(a) < len(b)
}
