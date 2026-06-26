package projectindex

import "github.com/use-crux/crux/packages/local/internal/projectindex/wire"

type ProjectIndexPatchStreamOptions = wire.ProjectIndexPatchStreamOptions
type ProjectIndexPatchStreamCollector = wire.ProjectIndexPatchStreamCollector
type ProjectIndexPhaseTiming = wire.ProjectIndexPhaseTiming

type ProjectIndexArtifactKind = wire.ProjectIndexArtifactKind

const (
	ProjectIndexArtifactProjectModel                 = wire.ProjectIndexArtifactProjectModel
	ProjectIndexArtifactProjectConfig                = wire.ProjectIndexArtifactProjectConfig
	ProjectIndexArtifactStaticIndexConfig            = wire.ProjectIndexArtifactStaticIndexConfig
	ProjectIndexArtifactStaticSyntaxPlan             = wire.ProjectIndexArtifactStaticSyntaxPlan
	ProjectIndexArtifactStaticExtensionHostManifest  = wire.ProjectIndexArtifactStaticExtensionHostManifest
	ProjectIndexArtifactStaticExtensionEvidenceBatch = wire.ProjectIndexArtifactStaticExtensionEvidenceBatch
	ProjectIndexArtifactStaticRuleCheck              = wire.ProjectIndexArtifactStaticRuleCheck
)

type ProjectIndexArtifactStreamOptions = wire.ProjectIndexArtifactStreamOptions
type ProjectIndexArtifactStreamCollector = wire.ProjectIndexArtifactStreamCollector

var NewProjectIndexPatchStreamCollector = wire.NewProjectIndexPatchStreamCollector
var NewProjectIndexArtifactStreamCollector = wire.NewProjectIndexArtifactStreamCollector
