package run

import (
	"encoding/json"

	"github.com/use-crux/crux/packages/local/internal/projectindex/staticindex/frontend/record"
	"github.com/use-crux/crux/packages/local/internal/projectindex/staticindex/protocol"
	"github.com/use-crux/crux/packages/local/internal/projectindex/staticindex/sourceprofile"
)

// prepareRequest builds the Static Index prepare request from the planned
// project and the resolved source profile input.
func prepareRequest(request Request, identity protocol.RunIdentity, sourceInput sourceprofile.Input) protocol.PrepareRequest {
	return protocol.PrepareRequest{
		ProtocolVersion:          protocol.Version,
		Method:                   protocol.PrepareMethod,
		Root:                     request.Root,
		ConfigPath:               request.ConfigPath,
		ProjectName:              request.ProjectName,
		Identity:                 identity,
		Files:                    sourceInput.Files,
		PrimaryFiles:             sourceInput.PrimaryFiles,
		CallNames:                append([]string(nil), request.Plan.CallNames...),
		CallInterests:            record.CallInterests(request.Plan.CallInterests),
		ConstructorNames:         append([]string(nil), request.Plan.ConstructorNames...),
		ConstructorInterests:     record.ConstructorInterests(request.Plan.ConstructorInterests),
		PruneNativeFactCallNames: append([]string(nil), request.Plan.PruneNativeFactCallNames...),
		CacheInputs:              append([]json.RawMessage(nil), request.Plan.CacheInputs...),
		ExtensionHost:            request.Plan.StaticHost,
	}
}
