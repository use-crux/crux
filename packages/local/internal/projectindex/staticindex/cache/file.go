package cache

import (
	"encoding/json"
	"fmt"
	"os"

	"github.com/use-crux/crux/packages/local/internal/projectindex"
)

type Extraction struct {
	File                 string                                                 `json:"file,omitempty"`
	InterfaceHash        string                                                 `json:"interfaceHash,omitempty"`
	Definitions          []json.RawMessage                                      `json:"definitions"`
	DefinitionExtractors map[string][]projectindex.IndexFactExtractorProvenance `json:"definitionExtractors,omitempty"`
	Relations            []json.RawMessage                                      `json:"relations"`
	Dependencies         []string                                               `json:"dependencies"`
	Diagnostics          []json.RawMessage                                      `json:"diagnostics"`
	SemanticProfile      *projectindex.SemanticSourceProfileFile                `json:"semanticProfile,omitempty"`
}

func ReadExtraction(root string, cacheKey string) (Extraction, error) {
	data, err := os.ReadFile(FileForIdentity(root, cacheKey))
	if err != nil {
		return Extraction{}, err
	}
	var extraction Extraction
	if err := json.Unmarshal(data, &extraction); err != nil {
		return Extraction{}, err
	}
	if !validExtraction(extraction) {
		return Extraction{}, fmt.Errorf("invalid static cache extraction shape")
	}
	return extraction, nil
}

func validExtraction(extraction Extraction) bool {
	return extraction.Definitions != nil &&
		extraction.Relations != nil &&
		extraction.Dependencies != nil &&
		extraction.Diagnostics != nil
}

func extractionMatchesManifest(
	file string,
	sourceHash string,
	extraction Extraction,
) bool {
	if extraction.File != "" && extraction.File != file {
		return false
	}
	if extraction.SemanticProfile == nil {
		return true
	}
	if extraction.SemanticProfile.File != "" && extraction.SemanticProfile.File != file {
		return false
	}
	if extraction.SemanticProfile.SourceHash != "" && extraction.SemanticProfile.SourceHash != sourceHash {
		return false
	}
	return true
}

func ValidExtractionFile(root string, cacheKey string) bool {
	_, err := ReadExtraction(root, cacheKey)
	return err == nil
}
