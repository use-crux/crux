package staticprotocol

import "fmt"

func ValidateWorkerResponse(gotID uint64, ok bool, message string, wantID uint64) error {
	if gotID != wantID {
		return fmt.Errorf("native static compiler response id %d, want %d", gotID, wantID)
	}
	if !ok {
		if message == "" {
			return fmt.Errorf("native static compiler failed")
		}
		return fmt.Errorf("native static compiler failed: %s", message)
	}
	return nil
}

func ValidateResponse(protocolVersion int, method, wantMethod string) error {
	if protocolVersion != Version {
		return fmt.Errorf("native static compiler protocol version %d, want %d", protocolVersion, Version)
	}
	if method != wantMethod {
		return fmt.Errorf("native static compiler method %q, want %q", method, wantMethod)
	}
	return nil
}
