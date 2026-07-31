package preview

import (
	"encoding/json"
	"fmt"
	"sort"
	"unicode/utf8"
)

// DecodeCapability rejects unknown fields and validates one complete group.
func DecodeCapability(data []byte) (*Capability, error) {
	compactBytes, err := compactJSONBytes(data)
	if err != nil || compactBytes > MaxCapabilityBytes {
		return nil, fmt.Errorf("capability too large")
	}
	var capability Capability
	if err := strictDecode(data, &capability); err != nil {
		return nil, err
	}
	if err := validateCapabilityOptionals(data); err != nil {
		return nil, err
	}
	if capability.Command != Command || capability.CatalogueRevision == 0 ||
		capability.CatalogueRevision > MaxSafeInteger ||
		len(capability.Targets) == 0 || len(capability.Targets) > MaxTargets {
		return nil, fmt.Errorf("invalid capability envelope")
	}
	seen := make(map[string]struct{}, len(capability.Targets))
	for i := range capability.Targets {
		target := &capability.Targets[i]
		if err := validateTarget(*target); err != nil {
			return nil, err
		}
		if _, exists := seen[target.DefinitionID]; exists {
			return nil, fmt.Errorf("duplicate target")
		}
		seen[target.DefinitionID] = struct{}{}
	}
	sort.Slice(capability.Targets, func(i, j int) bool {
		return capability.Targets[i].DefinitionID < capability.Targets[j].DefinitionID
	})
	return &capability, nil
}

// DecodeDispatch validates and detaches one typed payload before peer selection.
func DecodeDispatch(commandID, targetID, environment string, revision uint64, payload json.RawMessage, deadlineMS int) (Payload, error) {
	if commandID == "" || utf16Length(commandID) > 128 || !utf8.ValidString(commandID) ||
		targetID == "" || utf16Length(targetID) > 512 || !utf8.ValidString(targetID) ||
		revision == 0 || revision > MaxSafeInteger ||
		deadlineMS < 0 || deadlineMS > MaxDeadlineMS ||
		!validEnvironment(environment) {
		return Payload{}, NewFailure("invalid_request")
	}
	if len(payload) == 0 {
		return Payload{}, NewFailure("invalid_request")
	}
	var decoded Payload
	if err := strictDecode(payload, &decoded); err != nil || decoded.Input == nil {
		return Payload{}, NewFailure("invalid_request")
	}
	if err := validatePayloadOptionals(payload); err != nil {
		return Payload{}, NewFailure("invalid_request")
	}
	if err := validateJSONValue(decoded.Input); err != nil {
		return Payload{}, NewFailure("invalid_request")
	}
	if decoded.Options != nil {
		if invalidOptionalString(decoded.Options.Provider, 128) ||
			invalidOptionalString(decoded.Options.ModelID, 256) {
			return Payload{}, NewFailure("invalid_request")
		}
	}
	encoded, err := MarshalRequestJSON(Request{
		Type: "command.request", CommandID: commandID, Command: Command,
		TargetID: targetID, CatalogueRevision: revision,
		Payload: payload, DeadlineMS: effectiveDeadline(deadlineMS),
	})
	if err != nil {
		return Payload{}, NewFailure("invalid_request")
	}
	if len(encoded) > MaxRequestBytes {
		return Payload{}, NewFailure("input_limit_exceeded")
	}
	return decoded, nil
}

// ValidateDispatch checks a request without retaining its decoded payload.
func ValidateDispatch(targetID, environment string, revision uint64, payload json.RawMessage, deadlineMS int) error {
	_, err := DecodeDispatch("cmd", targetID, environment, revision, payload, deadlineMS)
	return err
}

func validatePayloadOptionals(data []byte) error {
	var fields struct {
		Options json.RawMessage `json:"options"`
	}
	if err := json.Unmarshal(data, &fields); err != nil {
		return err
	}
	if len(fields.Options) == 0 {
		return nil
	}
	if isJSONNull(fields.Options) {
		return fmt.Errorf("options must be omitted")
	}
	var options map[string]json.RawMessage
	if err := json.Unmarshal(fields.Options, &options); err != nil {
		return err
	}
	for _, name := range []string{"provider", "modelId"} {
		if isJSONNull(options[name]) {
			return fmt.Errorf("%s must be omitted", name)
		}
	}
	return nil
}

func invalidOptionalString(value *string, limit int) bool {
	return value != nil && (*value == "" || utf16Length(*value) > limit ||
		!utf8.ValidString(*value))
}

func EffectiveDeadline(deadlineMS int) int {
	return effectiveDeadline(deadlineMS)
}

func effectiveDeadline(deadlineMS int) int {
	if deadlineMS <= 0 || deadlineMS > DefaultDeadlineMS {
		return DefaultDeadlineMS
	}
	return deadlineMS
}

func validateTarget(target Target) error {
	if target.DefinitionID == "" || utf16Length(target.DefinitionID) > 512 ||
		target.Kind != "prompt" || target.Name == "" || utf16Length(target.Name) > 512 ||
		utf16Length(target.Description) > 4096 {
		return fmt.Errorf("invalid target")
	}
	switch target.Input.Mode {
	case "none", "raw":
		if target.Input.Schema != nil {
			return fmt.Errorf("unexpected schema")
		}
	case "schema":
		if target.Input.Schema == nil {
			return fmt.Errorf("missing schema")
		}
		encoded, err := json.Marshal(target.Input.Schema)
		if err != nil || len(encoded) > MaxSchemaBytes {
			return fmt.Errorf("invalid schema")
		}
	default:
		return fmt.Errorf("invalid input mode")
	}
	return nil
}
