package model

import (
	"fmt"
	"strings"
	"unicode"
	"unicode/utf8"
)

const (
	maxMCPProtocolVersionCodePoints = 64
	maxMCPServerNameCodePoints      = 256
	maxMCPServerVersionCodePoints   = 128
)

func normalizeRuntimeOwnerFacts(update ProjectIndexRuntimeUpdate) error {
	if update.Operation == RuntimeUpdateFailure {
		if update.OwnerFacts != nil {
			return fmt.Errorf("runtime failure cannot carry owner facts")
		}
		return nil
	}
	if update.OwnerFacts == nil {
		return fmt.Errorf("runtime replacement requires owner facts")
	}
	facts := update.OwnerFacts
	if facts.Kind != "mcp.discovery" {
		return fmt.Errorf("runtime owner facts kind is not supported")
	}
	if facts.Implementation != "official-client" && facts.Implementation != "ai-sdk-native" {
		return fmt.Errorf("runtime MCP implementation is not supported")
	}
	if err := normalizeOptionalOwnerText(facts.ProtocolVersion, maxMCPProtocolVersionCodePoints); err != nil {
		return fmt.Errorf("runtime MCP protocol version is invalid: %w", err)
	}
	if facts.Server == nil {
		return nil
	}
	if !facts.Server.Untrusted {
		return fmt.Errorf("runtime MCP server identity must be marked untrusted")
	}
	if err := normalizeOptionalOwnerText(facts.Server.Name, maxMCPServerNameCodePoints); err != nil {
		return fmt.Errorf("runtime MCP server name is invalid: %w", err)
	}
	if err := normalizeOptionalOwnerText(facts.Server.Version, maxMCPServerVersionCodePoints); err != nil {
		return fmt.Errorf("runtime MCP server version is invalid: %w", err)
	}
	if facts.Server.Name == nil && facts.Server.Version == nil {
		return fmt.Errorf("runtime MCP server identity is empty")
	}
	return nil
}

func normalizeOptionalOwnerText(value *string, maxCodePoints int) error {
	if value == nil {
		return nil
	}
	normalized := strings.TrimSpace(*value)
	if normalized == "" {
		return fmt.Errorf("value must not be empty")
	}
	if utf8.RuneCountInString(normalized) > maxCodePoints {
		return fmt.Errorf("value exceeds %d code points", maxCodePoints)
	}
	for _, character := range normalized {
		if unicode.IsControl(character) {
			return fmt.Errorf("value contains a control character")
		}
	}
	*value = normalized
	return nil
}

func successfulDiscovery(update ProjectIndexRuntimeUpdate) *RuntimeSuccessfulDiscovery {
	facts := update.OwnerFacts
	if facts == nil {
		return nil
	}
	return &RuntimeSuccessfulDiscovery{
		ObservedAt:      update.ObservedAt,
		Implementation:  facts.Implementation,
		ProtocolVersion: cloneString(facts.ProtocolVersion),
		Server:          cloneRuntimeServerIdentity(facts.Server),
	}
}

func cloneRuntimeServerIdentity(value *RuntimeOwnerServerIdentity) *RuntimeOwnerServerIdentity {
	if value == nil {
		return nil
	}
	return &RuntimeOwnerServerIdentity{
		Untrusted: value.Untrusted,
		Name:      cloneString(value.Name),
		Version:   cloneString(value.Version),
	}
}

func cloneString(value *string) *string {
	if value == nil {
		return nil
	}
	cloned := *value
	return &cloned
}
