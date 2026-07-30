package promptlatest

import (
	"net/url"
	"strings"
	"unicode/utf16"
	"unicode/utf8"
)

const routePrefix = "/api/devtools/prompt-latest-run/"

func parseDefinitionID(
	requestTarget string,
	escapedPath string,
	rawQuery string,
	forceQuery bool,
	fragment string,
) (string, bool) {
	if len(requestTarget) > maxRequestTargetBytes ||
		rawQuery != "" ||
		forceQuery ||
		fragment != "" ||
		!strings.HasPrefix(escapedPath, routePrefix) {
		return "", false
	}
	component := strings.TrimPrefix(escapedPath, routePrefix)
	if component == "" || strings.Contains(component, "/") {
		return "", false
	}
	definitionID, err := url.PathUnescape(component)
	if err != nil || strings.ContainsAny(definitionID, `/\`) ||
		containsControl(definitionID) ||
		!validScalarString(definitionID, 1, maxIDCodeUnits) {
		return "", false
	}
	return definitionID, true
}

func encodeURIComponent(value string) string {
	const hexadecimal = "0123456789ABCDEF"
	var encoded strings.Builder
	for _, current := range []byte(value) {
		if isURIComponentByte(current) {
			encoded.WriteByte(current)
			continue
		}
		encoded.WriteByte('%')
		encoded.WriteByte(hexadecimal[current>>4])
		encoded.WriteByte(hexadecimal[current&0x0f])
	}
	return encoded.String()
}

func isURIComponentByte(value byte) bool {
	return value >= 'a' && value <= 'z' ||
		value >= 'A' && value <= 'Z' ||
		value >= '0' && value <= '9' ||
		strings.ContainsRune("-_.!~*'()", rune(value))
}

func validScalarString(value string, minimum, maximum int) bool {
	if !utf8.ValidString(value) {
		return false
	}
	for _, current := range value {
		if current >= 0xd800 && current <= 0xdfff {
			return false
		}
	}
	length := len(utf16.Encode([]rune(value)))
	return length >= minimum && length <= maximum
}

func containsControl(value string) bool {
	for _, current := range value {
		if current <= 0x1f || current == 0x7f {
			return true
		}
	}
	return false
}
