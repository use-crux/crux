package prompttext

import (
	"net/url"
	"strings"
	"unicode/utf8"

	"github.com/use-crux/crux/packages/local/internal/lsp/protocol"
)

// resolveLinkTarget classifies one parser-confirmed CommonMark destination.
// It performs deterministic syntax and lexical-path checks only; target
// existence, DNS, network access, and physical symlink traversal are outside
// this boundary.
func resolveLinkTarget(
	destination string,
	sourceFile string,
	scopeRoot string,
) (protocol.DocumentURI, bool) {
	if !validRawDestination(destination) {
		return "", false
	}
	parsed, err := url.Parse(destination)
	if err != nil {
		return "", false
	}
	if strings.EqualFold(parsed.Scheme, "http") ||
		strings.EqualFold(parsed.Scheme, "https") {
		return resolveWebTarget(parsed)
	}
	return resolveLocalTarget(parsed, sourceFile, scopeRoot)
}

func validEscapedComponent(component string) bool {
	decoded, err := url.PathUnescape(component)
	if err != nil || !utf8.ValidString(decoded) {
		return false
	}
	for _, value := range decoded {
		if value == '\\' || value <= 0x1f || value == 0x7f {
			return false
		}
	}
	return true
}

func validRawDestination(destination string) bool {
	if destination == "" || !utf8.ValidString(destination) {
		return false
	}
	for _, value := range destination {
		if value == '\\' || value <= 0x1f || value == 0x7f ||
			isUnicodeWhiteSpace(value) {
			return false
		}
	}
	for index := 0; index < len(destination); index++ {
		if destination[index] != '%' {
			continue
		}
		if index+2 >= len(destination) ||
			!isHex(destination[index+1]) ||
			!isHex(destination[index+2]) {
			return false
		}
		index += 2
	}
	return true
}

func isUnicodeWhiteSpace(value rune) bool {
	return value >= 0x09 && value <= 0x0d ||
		value == 0x20 || value == 0x85 || value == 0xa0 ||
		value == 0x1680 || value >= 0x2000 && value <= 0x200a ||
		value == 0x2028 || value == 0x2029 || value == 0x202f ||
		value == 0x205f || value == 0x3000
}

func isHex(value byte) bool {
	_, ok := hexValue(value)
	return ok
}

func hexValue(value byte) (byte, bool) {
	switch {
	case value >= '0' && value <= '9':
		return value - '0', true
	case value >= 'a' && value <= 'f':
		return value - 'a' + 10, true
	case value >= 'A' && value <= 'F':
		return value - 'A' + 10, true
	default:
		return 0, false
	}
}
