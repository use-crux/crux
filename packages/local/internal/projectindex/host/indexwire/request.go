package indexwire

import (
	"encoding/json"
	"fmt"
	"time"

	"github.com/use-crux/crux/packages/local/internal/projectindex"
	"github.com/use-crux/crux/packages/local/internal/store"
)

const (
	BatchSize                   = 128
	SyntaxRecordBatchMaxRecords = 32
	SyntaxRecordBatchMaxBytes   = 8 * 1024 * 1024
)

// Request is the V2 NDJSON envelope exchanged with the TypeScript indexer
// worker. Keep this package focused on wire shape and transport batching.
type Request struct {
	ProtocolVersion               int                                      `json:"protocolVersion,omitempty"`
	Method                        string                                   `json:"method"`
	RequestID                     string                                   `json:"requestId,omitempty"`
	RequestKind                   string                                   `json:"requestKind,omitempty"`
	Root                          string                                   `json:"root"`
	ConfigPath                    string                                   `json:"configPath,omitempty"`
	ProjectName                   string                                   `json:"projectName,omitempty"`
	ResolutionMode                string                                   `json:"resolutionMode,omitempty"`
	SemanticBudget                *projectindex.IndexPatchBudget           `json:"semanticBudget,omitempty"`
	PreviousIndex                 *store.IndexData                         `json:"previousIndex,omitempty"`
	PreviousDefinitions           []store.ProjectDefinition                `json:"previousIndexDefinitions,omitempty"`
	PreviousSources               []store.IndexSourceFile                  `json:"previousIndexSources,omitempty"`
	Files                         []string                                 `json:"files,omitempty"`
	DeletedFiles                  []string                                 `json:"deletedFiles,omitempty"`
	SyntaxRecords                 []json.RawMessage                        `json:"syntaxRecords,omitempty"`
	SyntaxRecordsBatch            []json.RawMessage                        `json:"syntaxRecordsBatch,omitempty"`
	SyntaxFrontend                *projectindex.SyntaxFrontend             `json:"syntaxFrontendIdentity,omitempty"`
	NativeFactProjection          string                                   `json:"nativeFactProjection,omitempty"`
	Jobs                          []json.RawMessage                        `json:"jobs,omitempty"`
	Graph                         json.RawMessage                          `json:"graph,omitempty"`
	AvailableFacts                json.RawMessage                          `json:"availableFacts,omitempty"`
	NativeLintFinalize            bool                                     `json:"nativeLintFinalize,omitempty"`
	DependencyClosure             []string                                 `json:"dependencyClosure,omitempty"`
	SourceProfile                 *projectindex.SemanticSourceProfile      `json:"sourceProfile,omitempty"`
	SourceProfileFiles            []projectindex.SemanticSourceProfileFile `json:"sourceProfileFiles,omitempty"`
	Mode                          string                                   `json:"mode,omitempty"`
	MaxAffectedFiles              int                                      `json:"maxAffectedFiles,omitempty"`
	IncludeStaticCacheStatus      bool                                     `json:"includeStaticCacheStatus,omitempty"`
	StaticCacheHits               []projectindex.StaticCacheHit            `json:"staticCacheHits,omitempty"`
	NativeCompilerProtocolVersion int                                      `json:"nativeCompilerProtocolVersion,omitempty"`
}

func NewID(prefix string) string {
	if prefix == "" {
		prefix = "index"
	}
	return fmt.Sprintf("%s:%d", prefix, time.Now().UnixNano())
}

func MaxFactsPerBatch(method string) int {
	switch method {
	case "indexProjectSemantic":
		return 100
	case "indexProjectAst", "indexProjectAstFromSyntaxRecords", "indexProjectIncremental":
		return 200
	default:
		return 100
	}
}
