package server

import "encoding/json"

// Settings is the validated editor configuration used by all workspace scopes.
type Settings struct {
	Port              int
	Profile           string
	IncludeSuppressed bool
	InlayHintsEnabled bool
	CodeLensEnabled   bool
	Trace             string
}

func defaultSettings(port int) Settings {
	if port == 0 {
		port = 4400
	}
	return Settings{Port: port, InlayHintsEnabled: true, CodeLensEnabled: true, Trace: "off"}
}

func mergeSettings(current Settings, raw json.RawMessage) Settings {
	if len(raw) == 0 {
		return current
	}
	var input struct {
		Crux struct {
			Port       json.RawMessage `json:"port"`
			Trace      json.RawMessage `json:"trace"`
			InlayHints struct {
				Enabled json.RawMessage `json:"enabled"`
			} `json:"inlayHints"`
			CodeLens struct {
				Enabled json.RawMessage `json:"enabled"`
			} `json:"codeLens"`
			Lint struct {
				Profile           json.RawMessage `json:"profile"`
				IncludeSuppressed json.RawMessage `json:"includeSuppressed"`
			} `json:"lint"`
		} `json:"crux"`
	}
	if json.Unmarshal(raw, &input) != nil {
		return current
	}
	if value, ok := decodeInt(input.Crux.Port); ok && value > 0 && value <= 65535 {
		current.Port = value
	}
	if value, ok := decodeString(input.Crux.Lint.Profile); ok && validProfile(value) {
		current.Profile = value
	}
	if value, ok := decodeBool(input.Crux.Lint.IncludeSuppressed); ok {
		current.IncludeSuppressed = value
	}
	if value, ok := decodeBool(input.Crux.InlayHints.Enabled); ok {
		current.InlayHintsEnabled = value
	}
	if value, ok := decodeBool(input.Crux.CodeLens.Enabled); ok {
		current.CodeLensEnabled = value
	}
	if value, ok := decodeString(input.Crux.Trace); ok && (value == "off" || value == "messages") {
		current.Trace = value
	}
	return current
}

func validProfile(value string) bool {
	switch value {
	case "", "off", "recommended", "strict", "experimental":
		return true
	default:
		return false
	}
}

func decodeInt(raw json.RawMessage) (int, bool) {
	var value int
	return value, len(raw) > 0 && json.Unmarshal(raw, &value) == nil
}

func decodeString(raw json.RawMessage) (string, bool) {
	var value string
	return value, len(raw) > 0 && json.Unmarshal(raw, &value) == nil
}

func decodeBool(raw json.RawMessage) (bool, bool) {
	var value bool
	return value, len(raw) > 0 && json.Unmarshal(raw, &value) == nil
}
