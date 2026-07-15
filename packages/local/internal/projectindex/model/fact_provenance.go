package model

import (
	"fmt"
	"strings"
)

// IndexFactExtractorProvenance identifies one extractor that actually
// contributed to a durable fact. Extension is omitted for first-party work.
type IndexFactExtractorProvenance struct {
	Name      string             `json:"name"`
	Extension *IndexFactProducer `json:"extension,omitempty"`
}

func validateIndexFactExtractors(factID string, extractors []IndexFactExtractorProvenance) error {
	var previous *IndexFactExtractorProvenance
	for index := range extractors {
		extractor := &extractors[index]
		if invalidIndexFactIdentity(extractor.Name) {
			return fmt.Errorf("project index fact %q has invalid extractor name", factID)
		}
		if extractor.Extension != nil &&
			(invalidIndexFactIdentity(extractor.Extension.Name) || invalidIndexFactIdentity(extractor.Extension.Version)) {
			return fmt.Errorf("project index fact %q has invalid extractor extension identity", factID)
		}
		if previous != nil && compareIndexFactExtractors(*previous, *extractor) >= 0 {
			return fmt.Errorf("project index fact %q extractor provenance is not canonical", factID)
		}
		previous = extractor
	}
	return nil
}

func compareIndexFactExtractors(left, right IndexFactExtractorProvenance) int {
	leftName, leftVersion := "", ""
	rightName, rightVersion := "", ""
	if left.Extension != nil {
		leftName, leftVersion = left.Extension.Name, left.Extension.Version
	}
	if right.Extension != nil {
		rightName, rightVersion = right.Extension.Name, right.Extension.Version
	}
	if compared := strings.Compare(leftName, rightName); compared != 0 {
		return compared
	}
	if compared := strings.Compare(leftVersion, rightVersion); compared != 0 {
		return compared
	}
	return strings.Compare(left.Name, right.Name)
}

func invalidIndexFactIdentity(value string) bool {
	if value == "" {
		return true
	}
	for _, character := range value {
		if character < 0x20 || character == 0x7f {
			return true
		}
	}
	return false
}
