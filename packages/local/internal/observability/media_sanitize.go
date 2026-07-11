package observability

import (
	"bytes"
	"encoding/json"
	"math"
	"regexp"
	"sort"
	"strings"
)

const (
	mediaSanitizeMaxDepth      = 8
	mediaSanitizeMaxKeys       = 100
	mediaSanitizeMaxArrayItems = 100
	mediaSanitizeMaxString     = 64 * 1024
)

var (
	mediaMIMEPattern      = regexp.MustCompile(`(?i)^[a-z0-9!#$&^_.+-]+/[a-z0-9!#$&^_.+-]+$`)
	mediaDigestPattern    = regexp.MustCompile(`(?i)^[a-f0-9]{8,}$`)
	mediaSensitiveKey     = regexp.MustCompile(`(?i)^(file_?id|provider_?file_?id|filename|ref|uri|url)$`)
	mediaBase64Characters = regexp.MustCompile(`(?i)^[a-z0-9+/=_-]+$`)
)

func sanitizedArtifactPreview(preview json.RawMessage) (json.RawMessage, bool) {
	if len(preview) == 0 {
		return preview, false
	}
	var decoded any
	if err := json.Unmarshal(preview, &decoded); err != nil {
		return preview, false
	}
	sanitized := sanitizeRetainedValue(decoded, 0)
	encoded, err := json.Marshal(sanitized)
	if err != nil {
		return preview, false
	}
	return json.RawMessage(encoded), !bytes.Equal(bytes.TrimSpace(preview), encoded)
}

func sanitizeRetainedValue(value any, depth int) any {
	if depth >= mediaSanitizeMaxDepth {
		return "[Truncated]"
	}
	switch typed := value.(type) {
	case nil, bool, float64:
		return typed
	case string:
		return sanitizeRetainedString(typed)
	case []any:
		limit := len(typed)
		if limit > mediaSanitizeMaxArrayItems {
			limit = mediaSanitizeMaxArrayItems
		}
		out := make([]any, 0, limit+1)
		for _, item := range typed[:limit] {
			out = append(out, sanitizeRetainedValue(item, depth+1))
		}
		if len(typed) > limit {
			out = append(out, "[Truncated]")
		}
		return out
	case map[string]any:
		if descriptor, ok := retainedMediaDescriptor(typed); ok {
			return descriptor
		}
		return sanitizeRetainedMap(typed, depth)
	default:
		return "[Uninspectable]"
	}
}

func sanitizeRetainedMap(value map[string]any, depth int) map[string]any {
	keys := make([]string, 0, len(value))
	for key := range value {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	out := make(map[string]any, min(len(keys), mediaSanitizeMaxKeys)+1)
	for index, key := range keys {
		if index >= mediaSanitizeMaxKeys {
			out["__truncated"] = true
			break
		}
		if mediaSensitiveKey.MatchString(key) {
			out[key] = sanitizeRetainedLocator(key, value[key])
			continue
		}
		out[key] = sanitizeRetainedValue(value[key], depth+1)
	}
	return out
}

func retainedMediaDescriptor(value map[string]any) (map[string]any, bool) {
	kind, _ := value["kind"].(string)
	if kind != "image" && kind != "file" {
		kind, _ = value["type"].(string)
	}
	if kind != "image" && kind != "file" {
		return nil, false
	}
	source := value["source"]
	sourceFacts, _ := source.(map[string]any)
	out := map[string]any{
		"kind":           kind,
		"sourceCategory": retainedSourceCategory(value, source),
	}
	if mediaType := retainedMediaType(value["mediaType"], sourceFacts["mediaType"]); mediaType != "" {
		out["mediaType"] = mediaType
	}
	copyRetainedNumber(out, "sizeBytes", value["sizeBytes"], value["size"], sourceFacts["size"])
	copyRetainedNumber(out, "width", value["width"], sourceFacts["width"])
	copyRetainedNumber(out, "height", value["height"], sourceFacts["height"])
	copyRetainedNumber(out, "durationSeconds", value["durationSeconds"], value["durationInSeconds"], sourceFacts["durationInSeconds"])
	copyRetainedNumber(out, "pageCount", value["pageCount"], sourceFacts["pageCount"])
	if digest := retainedDigest(value["digestPrefix"], value["sha256"], sourceFacts["sha256"]); digest != "" {
		out["digestPrefix"] = digest
	}
	return out, true
}

func retainedSourceCategory(value map[string]any, source any) string {
	if category, ok := value["sourceCategory"].(string); ok && safeSourceCategory(category) {
		return category
	}
	if text, ok := source.(string); ok {
		if strings.HasPrefix(strings.ToLower(strings.TrimSpace(text)), "data:") {
			return "data-url"
		}
		return "url"
	}
	if record, ok := source.(map[string]any); ok {
		if _, exists := record["ref"]; exists {
			return "asset-ref"
		}
		if category, ok := record["type"].(string); ok && safeSourceCategory(category) {
			return category
		}
	}
	return "unknown"
}

func retainedMediaType(values ...any) string {
	for _, value := range values {
		text, ok := value.(string)
		if !ok {
			continue
		}
		text = strings.ToLower(strings.TrimSpace(strings.SplitN(text, ";", 2)[0]))
		if mediaMIMEPattern.MatchString(text) {
			return text
		}
	}
	return ""
}

func copyRetainedNumber(out map[string]any, key string, values ...any) {
	for _, value := range values {
		number, ok := value.(float64)
		if ok && !math.IsNaN(number) && !math.IsInf(number, 0) && number >= 0 {
			out[key] = number
			return
		}
	}
}

func retainedDigest(values ...any) string {
	for _, value := range values {
		text, ok := value.(string)
		if ok && mediaDigestPattern.MatchString(text) {
			return strings.ToLower(text[:min(len(text), 12)])
		}
	}
	return ""
}

func sanitizeRetainedString(value string) string {
	trimmed := strings.TrimSpace(value)
	lower := strings.ToLower(trimmed)
	if strings.HasPrefix(lower, "data:") || retainedBase64Like(trimmed) {
		return "[redacted media]"
	}
	if retainedURLLike(lower) {
		return "[url]"
	}
	if len(value) > mediaSanitizeMaxString {
		return value[:mediaSanitizeMaxString] + "[Truncated]"
	}
	return value
}

func sanitizeRetainedLocator(key string, value any) string {
	if strings.EqualFold(key, "url") || strings.EqualFold(key, "uri") {
		return "[url]"
	}
	if text, ok := value.(string); ok && retainedURLLike(strings.ToLower(strings.TrimSpace(text))) {
		return "[url]"
	}
	return "[redacted media]"
}

func retainedBase64Like(value string) bool {
	if len(value) < 32 || !mediaBase64Characters.MatchString(value) || mediaDigestPattern.MatchString(value) {
		return false
	}
	if strings.HasSuffix(value, "=") {
		return true
	}
	return len(value) >= 128 && len(value)%4 == 0 && distinctLowerBytes(value) >= 8
}

func distinctLowerBytes(value string) int {
	seen := map[byte]struct{}{}
	for index := 0; index < len(value); index++ {
		seen[value[index]|0x20] = struct{}{}
	}
	return len(seen)
}

func retainedURLLike(value string) bool {
	for _, prefix := range []string{"http://", "https://", "asset://", "convex://", "s3://", "gs://"} {
		if strings.HasPrefix(value, prefix) {
			return true
		}
	}
	return false
}

func safeSourceCategory(value string) bool {
	switch value {
	case "asset-ref", "blob", "bytes", "data", "data-url", "provider-file", "unknown", "url":
		return true
	default:
		return false
	}
}
