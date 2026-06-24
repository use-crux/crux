package projectindexer

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"

	"github.com/use-crux/crux/packages/local/internal/devtools"
)

type projectNativeStaticEvidenceBatchResult struct {
	Method      string            `json:"method"`
	Root        string            `json:"root"`
	Facts       json.RawMessage   `json:"facts"`
	Diagnostics []json.RawMessage `json:"diagnostics"`
}

type projectNativeStaticRuleCheckResult struct {
	Method          string            `json:"method"`
	Root            string            `json:"root"`
	Facts           json.RawMessage   `json:"facts"`
	Diagnostics     []json.RawMessage `json:"diagnostics"`
	RuleDescriptors []json.RawMessage `json:"ruleDescriptors"`
}

// projectNativeStaticExtensionHostManifest loads only configured extension
// runtime metadata needed by Go/Rust-owned native static planning.
func (w *Worker) projectNativeStaticExtensionHostManifest(
	ctx context.Context,
	root string,
	configPath string,
) (devtools.StaticExtensionHostManifestResult, error) {
	req := projectIndexRequest{
		Method:                        "loadStaticExtensionHostManifest",
		Root:                          root,
		ConfigPath:                    configPath,
		NativeCompilerProtocolVersion: projectNativeStaticProtocolVersion,
	}
	resp, err := w.streamArtifact(ctx, req, devtools.ProjectIndexArtifactStaticExtensionHostManifest)
	if err != nil {
		return devtools.StaticExtensionHostManifestResult{}, err
	}
	var result devtools.StaticExtensionHostManifestResult
	if err := json.Unmarshal(resp, &result); err != nil {
		return devtools.StaticExtensionHostManifestResult{}, fmt.Errorf("decode static extension host manifest: %w", err)
	}
	if result.Method != "loadStaticExtensionHostManifest" {
		return devtools.StaticExtensionHostManifestResult{}, fmt.Errorf("static extension host manifest method %q, want loadStaticExtensionHostManifest", result.Method)
	}
	if result.Root != "" && result.Root != root {
		return devtools.StaticExtensionHostManifestResult{}, fmt.Errorf("static extension host manifest root = %s, want %s", result.Root, root)
	}
	return result, nil
}

// projectNativeStaticExtensionEvidenceFacts runs TypeScript extractors selected
// by native evidence jobs and returns grouped facts for native finalization.
func (w *Worker) projectNativeStaticExtensionEvidenceFacts(
	ctx context.Context,
	root string,
	configPath string,
	projectName string,
	jobs []json.RawMessage,
) ([]json.RawMessage, error) {
	if len(jobs) == 0 {
		return nil, nil
	}
	req := projectIndexRequest{
		Method:         "extractStaticEvidenceBatch",
		Root:           root,
		ConfigPath:     configPath,
		ProjectName:    projectName,
		ResolutionMode: "source-only",
		Jobs:           jobs,
	}
	resp, err := w.streamArtifact(ctx, req, devtools.ProjectIndexArtifactStaticExtensionEvidenceBatch)
	if err != nil {
		return nil, err
	}
	var result projectNativeStaticEvidenceBatchResult
	if err := json.Unmarshal(resp, &result); err != nil {
		return nil, fmt.Errorf("decode static extension evidence result: %w", err)
	}
	if result.Method != "extractStaticEvidenceBatch" {
		return nil, fmt.Errorf("static extension evidence method %q, want extractStaticEvidenceBatch", result.Method)
	}
	if result.Root != "" && result.Root != root {
		return nil, fmt.Errorf("static extension evidence root = %s, want %s", result.Root, root)
	}
	return projectNativeStaticNonEmptyGroupedFacts(result.Facts), nil
}

// projectNativeStaticRuleFacts runs TypeScript rules against a native-finalized
// graph and returns grouped rule facts for a final native projection pass.
func (w *Worker) projectNativeStaticRuleFacts(
	ctx context.Context,
	root string,
	configPath string,
	projectName string,
	patch devtools.IndexPatch,
	files []string,
) ([]json.RawMessage, error) {
	graph, err := json.Marshal(map[string]any{
		"definitions": patch.Facts.Definitions,
		"relations":   patch.Facts.Relations,
	})
	if err != nil {
		return nil, fmt.Errorf("marshal static rule graph: %w", err)
	}
	req := projectIndexRequest{
		Method:             "checkStaticRules",
		Root:               root,
		ConfigPath:         configPath,
		ProjectName:        projectName,
		ResolutionMode:     "source-only",
		Graph:              graph,
		Files:              append([]string(nil), files...),
		NativeLintFinalize: true,
	}
	resp, err := w.streamArtifact(ctx, req, devtools.ProjectIndexArtifactStaticRuleCheck)
	if err != nil {
		return nil, err
	}
	var result projectNativeStaticRuleCheckResult
	if err := json.Unmarshal(resp, &result); err != nil {
		return nil, fmt.Errorf("decode static rule check result: %w", err)
	}
	if result.Method != "checkStaticRules" {
		return nil, fmt.Errorf("static rule check method %q, want checkStaticRules", result.Method)
	}
	if result.Root != "" && result.Root != root {
		return nil, fmt.Errorf("static rule check root = %s, want %s", result.Root, root)
	}
	return projectNativeStaticNonEmptyGroupedFacts(result.Facts), nil
}

func projectNativeStaticNonEmptyGroupedFacts(raw json.RawMessage) []json.RawMessage {
	raw = bytes.TrimSpace(raw)
	if len(raw) == 0 || bytes.Equal(raw, []byte("null")) || bytes.Equal(raw, []byte("{}")) {
		return nil
	}
	return []json.RawMessage{append(json.RawMessage(nil), raw...)}
}
