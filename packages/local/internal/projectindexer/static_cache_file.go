package projectindexer

import (
	"encoding/json"
	"fmt"
	"os"

	"github.com/use-crux/crux/packages/local/internal/devtools"
)

type projectNativeStaticCachedExtraction struct {
	File            string                              `json:"file,omitempty"`
	Definitions     []json.RawMessage                   `json:"definitions"`
	Relations       []json.RawMessage                   `json:"relations"`
	Dependencies    []string                            `json:"dependencies"`
	Diagnostics     []json.RawMessage                   `json:"diagnostics"`
	SemanticProfile *devtools.SemanticSourceProfileFile `json:"semanticProfile,omitempty"`
}

func projectNativeStaticReadCachedExtraction(root string, cacheKey string) (projectNativeStaticCachedExtraction, error) {
	data, err := os.ReadFile(projectNativeStaticCacheFileForIdentity(root, cacheKey))
	if err != nil {
		return projectNativeStaticCachedExtraction{}, err
	}
	var extraction projectNativeStaticCachedExtraction
	if err := json.Unmarshal(data, &extraction); err != nil {
		return projectNativeStaticCachedExtraction{}, err
	}
	if !projectNativeStaticValidCachedExtraction(extraction) {
		return projectNativeStaticCachedExtraction{}, fmt.Errorf("invalid static cache extraction shape")
	}
	return extraction, nil
}

func projectNativeStaticValidCachedExtraction(extraction projectNativeStaticCachedExtraction) bool {
	return extraction.Definitions != nil &&
		extraction.Relations != nil &&
		extraction.Dependencies != nil &&
		extraction.Diagnostics != nil
}

func projectNativeStaticCachedExtractionMatchesManifest(
	file string,
	sourceHash string,
	extraction projectNativeStaticCachedExtraction,
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

func projectNativeStaticValidExtractionCacheFile(root string, cacheKey string) bool {
	_, err := projectNativeStaticReadCachedExtraction(root, cacheKey)
	return err == nil
}
