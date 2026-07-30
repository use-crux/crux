package preview

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"math"
	"reflect"
	"unicode/utf8"
)

func strictDecode(data []byte, destination any) error {
	if !utf8.Valid(data) || hasUnpairedSurrogateEscape(data) {
		return fmt.Errorf("invalid Unicode scalar")
	}
	if err := rejectDuplicateKeys(data); err != nil {
		return err
	}
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(destination); err != nil {
		return err
	}
	if err := decoder.Decode(new(any)); err != io.EOF {
		return fmt.Errorf("trailing JSON")
	}
	return nil
}

// ValidateUniqueJSONKeys rejects duplicate object keys before typed decoding
// discards which spelling supplied the effective value.
func ValidateUniqueJSONKeys(data []byte) error {
	if !utf8.Valid(data) || hasUnpairedSurrogateEscape(data) {
		return fmt.Errorf("invalid Unicode scalar")
	}
	return rejectDuplicateKeys(data)
}

func compactJSONBytes(data []byte) (int, error) {
	var compact bytes.Buffer
	if err := json.Compact(&compact, data); err != nil {
		return 0, err
	}
	return compact.Len(), nil
}

func validateCapabilityOptionals(data []byte) error {
	var raw struct {
		Targets []struct {
			Description json.RawMessage `json:"description"`
			Input       struct {
				Mode   string          `json:"mode"`
				Schema json.RawMessage `json:"schema"`
			} `json:"input"`
		} `json:"targets"`
	}
	if err := json.Unmarshal(data, &raw); err != nil {
		return err
	}
	for _, target := range raw.Targets {
		if isJSONNull(target.Description) || isJSONNull(target.Input.Schema) {
			return fmt.Errorf("optional fields must be omitted")
		}
		if len(target.Description) != 0 {
			var description string
			if json.Unmarshal(target.Description, &description) != nil ||
				description == "" {
				return fmt.Errorf("invalid description")
			}
		}
		switch target.Input.Mode {
		case "schema":
			if len(target.Input.Schema) == 0 {
				return fmt.Errorf("missing schema")
			}
		case "none", "raw":
			if len(target.Input.Schema) != 0 {
				return fmt.Errorf("unexpected schema")
			}
		}
	}
	return nil
}

func isJSONNull(raw json.RawMessage) bool {
	return len(raw) != 0 && bytes.Equal(bytes.TrimSpace(raw), []byte("null"))
}

func hasUnpairedSurrogateEscape(data []byte) bool {
	inString := false
	for index := 0; index < len(data); index++ {
		if data[index] == '"' {
			inString = !inString
			continue
		}
		if !inString || data[index] != '\\' {
			continue
		}
		index++
		if index >= len(data) {
			return false
		}
		if data[index] != 'u' || index+4 >= len(data) {
			continue
		}
		code, ok := hexCodeUnit(data[index+1 : index+5])
		if !ok {
			continue
		}
		index += 4
		if code >= 0xdc00 && code <= 0xdfff {
			return true
		}
		if code < 0xd800 || code > 0xdbff {
			continue
		}
		if index+6 >= len(data) || data[index+1] != '\\' || data[index+2] != 'u' {
			return true
		}
		low, ok := hexCodeUnit(data[index+3 : index+7])
		if !ok || low < 0xdc00 || low > 0xdfff {
			return true
		}
		index += 6
	}
	return false
}

func hexCodeUnit(value []byte) (uint16, bool) {
	var out uint16
	for _, character := range value {
		out <<= 4
		switch {
		case character >= '0' && character <= '9':
			out += uint16(character - '0')
		case character >= 'a' && character <= 'f':
			out += uint16(character-'a') + 10
		case character >= 'A' && character <= 'F':
			out += uint16(character-'A') + 10
		default:
			return 0, false
		}
	}
	return out, true
}

func rejectDuplicateKeys(data []byte) error {
	decoder := json.NewDecoder(bytes.NewReader(data))
	var walk func() error
	walk = func() error {
		token, err := decoder.Token()
		if err != nil {
			return err
		}
		delimiter, ok := token.(json.Delim)
		if !ok {
			return nil
		}
		switch delimiter {
		case '{':
			keys := map[string]struct{}{}
			for decoder.More() {
				keyToken, err := decoder.Token()
				if err != nil {
					return err
				}
				key, ok := keyToken.(string)
				if !ok {
					return fmt.Errorf("invalid object key")
				}
				if _, exists := keys[key]; exists {
					return fmt.Errorf("duplicate object key")
				}
				keys[key] = struct{}{}
				if err := walk(); err != nil {
					return err
				}
			}
		case '[':
			for decoder.More() {
				if err := walk(); err != nil {
					return err
				}
			}
		}
		_, err = decoder.Token()
		return err
	}
	return walk()
}

func validateJSONValue(root map[string]any) error {
	counts := struct{ nodes, keys int }{}
	_, err := visitJSON(root, 1, &counts)
	return err
}

func visitJSON(value any, depth int, counts *struct{ nodes, keys int }) (int, error) {
	counts.nodes++
	if counts.nodes > MaxNodes {
		return 0, fmt.Errorf("too many nodes")
	}
	switch typed := value.(type) {
	case nil:
		return 4, nil
	case bool:
		if typed {
			return 4, nil
		}
		return 5, nil
	case float64:
		if math.IsInf(typed, 0) || math.IsNaN(typed) {
			return 0, fmt.Errorf("invalid number")
		}
		return 8, nil
	case string:
		if !utf8.ValidString(typed) || len([]byte(typed)) > MaxStringBytes {
			return 0, fmt.Errorf("invalid string")
		}
		return len([]byte(typed)), nil
	case []any:
		if depth > MaxDepth {
			return 0, fmt.Errorf("too deep")
		}
		weight := 2 + max(0, len(typed)-1)
		for _, child := range typed {
			childWeight, err := visitJSON(child, nextDepth(depth, child), counts)
			if err != nil {
				return 0, err
			}
			weight += childWeight
		}
		if weight > MaxDecodedValueWeight {
			return 0, fmt.Errorf("too heavy")
		}
		return weight, nil
	case map[string]any:
		if depth > MaxDepth {
			return 0, fmt.Errorf("too deep")
		}
		counts.keys += len(typed)
		if counts.keys > MaxKeys {
			return 0, fmt.Errorf("too many keys")
		}
		weight := 2 + max(0, len(typed)-1)
		for key, child := range typed {
			if !utf8.ValidString(key) || len([]byte(key)) > MaxKeyBytes {
				return 0, fmt.Errorf("invalid key")
			}
			childWeight, err := visitJSON(child, nextDepth(depth, child), counts)
			if err != nil {
				return 0, err
			}
			weight += len([]byte(key)) + 1 + childWeight
		}
		if weight > MaxDecodedValueWeight {
			return 0, fmt.Errorf("too heavy")
		}
		return weight, nil
	default:
		return 0, fmt.Errorf("foreign JSON type %s", reflect.TypeOf(value))
	}
}

func nextDepth(depth int, value any) int {
	switch value.(type) {
	case []any, map[string]any:
		return depth + 1
	default:
		return depth
	}
}

func validEnvironment(value string) bool {
	switch value {
	case "", "node", "convex", "serverless", "browser", "unknown":
		return true
	default:
		return false
	}
}

// ValidPeerEnvironment reports whether a peer advertises one exact wire enum.
func ValidPeerEnvironment(value string) bool {
	return value != "" && validEnvironment(value)
}
