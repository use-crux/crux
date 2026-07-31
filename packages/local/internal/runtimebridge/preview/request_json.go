package preview

import (
	"bytes"
	"fmt"
	"math"
	"sort"
	"strconv"
	"strings"
	"unicode/utf16"
	"unicode/utf8"
)

const RequestJSONVersion = "prompt-preview-request-json-v1"

// MarshalRequestJSON emits the canonical semantic request bytes measured by
// both Local and Core. Object keys use UTF-16 order and primitive values use
// ECMAScript JSON serialization; transport whitespace is never significant.
func MarshalRequestJSON(request Request) ([]byte, error) {
	var payload Payload
	if err := strictDecode(request.Payload, &payload); err != nil {
		return nil, err
	}
	payloadValue := map[string]any{"input": payload.Input}
	if payload.Options != nil {
		options := map[string]any{}
		if payload.Options.Provider != nil {
			options["provider"] = *payload.Options.Provider
		}
		if payload.Options.ModelID != nil {
			options["modelId"] = *payload.Options.ModelID
		}
		payloadValue["options"] = options
	}
	return appendCanonicalJSON(nil, map[string]any{
		"type":              request.Type,
		"commandId":         request.CommandID,
		"command":           request.Command,
		"targetId":          request.TargetID,
		"catalogueRevision": request.CatalogueRevision,
		"payload":           payloadValue,
		"deadlineMs":        request.DeadlineMS,
	})
}

func appendCanonicalJSON(dst []byte, value any) ([]byte, error) {
	switch typed := value.(type) {
	case nil:
		return append(dst, "null"...), nil
	case bool:
		return strconv.AppendBool(dst, typed), nil
	case string:
		return appendJSONString(dst, typed)
	case float64:
		return appendECMAScriptFloat(dst, typed)
	case int:
		return strconv.AppendInt(dst, int64(typed), 10), nil
	case uint64:
		return strconv.AppendUint(dst, typed, 10), nil
	case []any:
		dst = append(dst, '[')
		for index, item := range typed {
			if index > 0 {
				dst = append(dst, ',')
			}
			var err error
			dst, err = appendCanonicalJSON(dst, item)
			if err != nil {
				return nil, err
			}
		}
		return append(dst, ']'), nil
	case map[string]any:
		keys := make([]string, 0, len(typed))
		for key := range typed {
			keys = append(keys, key)
		}
		sort.Slice(keys, func(i, j int) bool {
			return compareUTF16(keys[i], keys[j]) < 0
		})
		dst = append(dst, '{')
		for index, key := range keys {
			if index > 0 {
				dst = append(dst, ',')
			}
			var err error
			dst, err = appendJSONString(dst, key)
			if err != nil {
				return nil, err
			}
			dst = append(dst, ':')
			dst, err = appendCanonicalJSON(dst, typed[key])
			if err != nil {
				return nil, err
			}
		}
		return append(dst, '}'), nil
	default:
		return nil, fmt.Errorf("unsupported canonical JSON value %T", value)
	}
}

func appendJSONString(dst []byte, value string) ([]byte, error) {
	if !utf8.ValidString(value) {
		return nil, fmt.Errorf("invalid UTF-8 string")
	}
	const hex = "0123456789abcdef"
	dst = append(dst, '"')
	for _, character := range value {
		switch character {
		case '"', '\\':
			dst = append(dst, '\\', byte(character))
		case '\b':
			dst = append(dst, '\\', 'b')
		case '\t':
			dst = append(dst, '\\', 't')
		case '\n':
			dst = append(dst, '\\', 'n')
		case '\f':
			dst = append(dst, '\\', 'f')
		case '\r':
			dst = append(dst, '\\', 'r')
		default:
			if character < 0x20 {
				dst = append(dst, '\\', 'u', '0', '0',
					hex[byte(character)>>4], hex[byte(character)&0xf])
			} else {
				dst = utf8.AppendRune(dst, character)
			}
		}
	}
	return append(dst, '"'), nil
}

func appendECMAScriptFloat(dst []byte, value float64) ([]byte, error) {
	if math.IsNaN(value) || math.IsInf(value, 0) {
		return nil, fmt.Errorf("nonfinite number")
	}
	if value == 0 {
		return append(dst, '0'), nil
	}
	if value < 0 {
		dst = append(dst, '-')
		value = -value
	}
	scientific := strconv.FormatFloat(value, 'e', -1, 64)
	mantissa, exponentText, ok := strings.Cut(scientific, "e")
	if !ok {
		return nil, fmt.Errorf("unexpected float encoding")
	}
	exponent, err := strconv.Atoi(exponentText)
	if err != nil {
		return nil, err
	}
	digits := strings.ReplaceAll(mantissa, ".", "")
	point := exponent + 1
	switch {
	case point > 0 && point <= 21:
		if len(digits) <= point {
			dst = append(dst, digits...)
			return append(dst, bytes.Repeat([]byte{'0'}, point-len(digits))...), nil
		}
		dst = append(dst, digits[:point]...)
		dst = append(dst, '.')
		return append(dst, digits[point:]...), nil
	case point > -6 && point <= 0:
		dst = append(dst, '0', '.')
		dst = append(dst, bytes.Repeat([]byte{'0'}, -point)...)
		return append(dst, digits...), nil
	default:
		dst = append(dst, digits[0])
		if len(digits) > 1 {
			dst = append(dst, '.')
			dst = append(dst, digits[1:]...)
		}
		dst = append(dst, 'e')
		if exponent >= 0 {
			dst = append(dst, '+')
		}
		return strconv.AppendInt(dst, int64(exponent), 10), nil
	}
}

func compareUTF16(left, right string) int {
	leftUnits := utf16.Encode([]rune(left))
	rightUnits := utf16.Encode([]rune(right))
	for index := 0; index < min(len(leftUnits), len(rightUnits)); index++ {
		if leftUnits[index] < rightUnits[index] {
			return -1
		}
		if leftUnits[index] > rightUnits[index] {
			return 1
		}
	}
	return len(leftUnits) - len(rightUnits)
}
