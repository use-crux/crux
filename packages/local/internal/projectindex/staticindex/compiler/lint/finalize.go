package lint

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/use-crux/crux/packages/local/internal/projectindex"
	"github.com/use-crux/crux/packages/local/internal/projectindex/staticindex/compiler/patch"
	"github.com/use-crux/crux/packages/local/internal/projectindex/staticindex/protocol"
	"github.com/use-crux/crux/packages/local/internal/store"
)

type Compiler interface {
	NativeStaticFinalize(context.Context, protocol.FinalizeRequest) (protocol.FinalizeResponse, error)
}

type FinalizeOptions struct {
	Root         string
	ProjectName  string
	Index        store.IndexData
	RuleFacts    []json.RawMessage
	PatchOptions patch.Options
}

func FinalizePatch(ctx context.Context, compiler Compiler, options FinalizeOptions) (projectindex.IndexPatch, bool, error) {
	lintFacts, err := Facts(options.Root, options.ProjectName, options.Index)
	if err != nil {
		return projectindex.IndexPatch{}, false, err
	}
	if len(lintFacts) == 0 {
		return projectindex.IndexPatch{}, false, nil
	}
	lintConfig, err := Config(options.Index)
	if err != nil {
		return projectindex.IndexPatch{}, false, err
	}
	emitBuiltinLints := true
	finalize, err := compiler.NativeStaticFinalize(ctx, protocol.FinalizeRequest{
		ProtocolVersion:  protocol.Version,
		Method:           protocol.FinalizeMethod,
		Identity:         protocol.SkeletonIdentity(),
		NativeFacts:      []json.RawMessage{},
		ExtensionFacts:   NormalizeRuleFacts(options.RuleFacts),
		LintFacts:        lintFacts,
		LintConfig:       lintConfig,
		LintFiles:        Files(options.Index),
		EmitBuiltinLints: &emitBuiltinLints,
		PatchPhase:       string(projectindex.PhaseQuality),
	})
	if err != nil {
		return projectindex.IndexPatch{}, false, fmt.Errorf("native static lint finalize: %w", err)
	}
	patch, _, usedNativeStatic, err := patch.FromEvents(options.PatchOptions, finalize.Events)
	if err != nil {
		return projectindex.IndexPatch{}, false, err
	}
	if !usedNativeStatic {
		return projectindex.IndexPatch{}, false, nil
	}
	return patch, true, nil
}

func GraphPatch(index store.IndexData) projectindex.IndexPatch {
	return projectindex.IndexPatch{
		Facts: projectindex.IndexPatchFacts{
			Definitions: append([]store.ProjectDefinition(nil), index.Definitions...),
			Relations:   append([]store.ProjectRelation(nil), index.Relations...),
		},
	}
}

func NormalizeRuleFacts(ruleFacts []json.RawMessage) []json.RawMessage {
	if ruleFacts == nil {
		return []json.RawMessage{}
	}
	return ruleFacts
}
