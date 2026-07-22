package protocol

import "fmt"

func ValidateWorkerResponse(gotID uint64, ok bool, message string, wantID uint64) error {
	if gotID != wantID {
		return fmt.Errorf("Static Index compiler response id %d, want %d", gotID, wantID)
	}
	if !ok {
		if message == "" {
			return fmt.Errorf("Static Index compiler failed")
		}
		return fmt.Errorf("Static Index compiler failed: %s", message)
	}
	return nil
}

func ValidateResponse(protocolVersion int, method, wantMethod string) error {
	if protocolVersion != Version {
		return fmt.Errorf("Static Index compiler protocol version %d, want %d", protocolVersion, Version)
	}
	if method != wantMethod {
		return fmt.Errorf("Static Index compiler method %q, want %q", method, wantMethod)
	}
	return nil
}

func ValidateLintSuppressions(suppressions []LintSuppression) error {
	for index, suppression := range suppressions {
		switch suppression.Scope {
		case LintSuppressionNextLine, LintSuppressionLine, LintSuppressionFile:
		default:
			return fmt.Errorf("Static Index lint suppression %d uses unsupported scope %q", index, suppression.Scope)
		}
	}
	return nil
}
