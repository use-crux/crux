package prompttext

import (
	"net"
	"net/url"
	"strconv"
	"strings"

	"github.com/use-crux/crux/packages/local/internal/lsp/protocol"
)

func resolveWebTarget(parsed *url.URL) (protocol.DocumentURI, bool) {
	if parsed.Opaque != "" || !validWebAuthority(parsed) ||
		!validEscapedComponent(parsed.EscapedPath()) ||
		!validEscapedComponent(parsed.RawQuery) ||
		!validEscapedComponent(parsed.EscapedFragment()) {
		return "", false
	}
	parsed.Scheme = strings.ToLower(parsed.Scheme)
	return protocol.DocumentURI(parsed.String()), true
}

func validWebAuthority(parsed *url.URL) bool {
	if parsed.User != nil || parsed.Host == "" ||
		strings.Contains(parsed.Host, "%") {
		return false
	}
	authority := parsed.Host
	if strings.HasPrefix(authority, "[") {
		closeBracket := strings.IndexByte(authority, ']')
		if closeBracket < 0 {
			return false
		}
		host := authority[1:closeBracket]
		address := net.ParseIP(host)
		if address == nil || !strings.Contains(host, ":") {
			return false
		}
		return validAuthorityPort(authority[closeBracket+1:])
	}
	if strings.ContainsAny(authority, "[]") || strings.Count(authority, ":") > 1 {
		return false
	}
	host := authority
	port := ""
	if separator := strings.LastIndexByte(authority, ':'); separator >= 0 {
		host = authority[:separator]
		port = authority[separator:]
	}
	return validRegName(host) && validAuthorityPort(port)
}

func validAuthorityPort(port string) bool {
	if port == "" {
		return true
	}
	if len(port) < 2 || port[0] != ':' {
		return false
	}
	for _, value := range port[1:] {
		if value < '0' || value > '9' {
			return false
		}
	}
	number, err := strconv.ParseUint(port[1:], 10, 16)
	return err == nil && number >= 1 && number <= 65535
}

func validRegName(host string) bool {
	if host == "" {
		return false
	}
	for _, value := range host {
		if value > 0x7f || !(value >= 'a' && value <= 'z') &&
			!(value >= 'A' && value <= 'Z') &&
			!(value >= '0' && value <= '9') &&
			!strings.ContainsRune("-._~!$&'()*+,;=", value) {
			return false
		}
	}
	return true
}
