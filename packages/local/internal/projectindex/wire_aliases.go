package projectindex

import "github.com/use-crux/crux/packages/local/internal/projectindexwire"

type ProjectIndexPatchStreamOptions = projectindexwire.ProjectIndexPatchStreamOptions
type ProjectIndexPatchStreamCollector = projectindexwire.ProjectIndexPatchStreamCollector
type ProjectIndexPhaseTiming = projectindexwire.ProjectIndexPhaseTiming

type ProjectIndexArtifactKind = projectindexwire.ProjectIndexArtifactKind

const (
	ProjectIndexArtifactProjectModel                 = projectindexwire.ProjectIndexArtifactProjectModel
	ProjectIndexArtifactProjectConfig                = projectindexwire.ProjectIndexArtifactProjectConfig
	ProjectIndexArtifactNativeStaticConfig           = projectindexwire.ProjectIndexArtifactNativeStaticConfig
	ProjectIndexArtifactStaticSyntaxPlan             = projectindexwire.ProjectIndexArtifactStaticSyntaxPlan
	ProjectIndexArtifactStaticExtensionHostManifest  = projectindexwire.ProjectIndexArtifactStaticExtensionHostManifest
	ProjectIndexArtifactStaticExtensionEvidenceBatch = projectindexwire.ProjectIndexArtifactStaticExtensionEvidenceBatch
	ProjectIndexArtifactStaticRuleCheck              = projectindexwire.ProjectIndexArtifactStaticRuleCheck
)

type ProjectIndexArtifactStreamOptions = projectindexwire.ProjectIndexArtifactStreamOptions
type ProjectIndexArtifactStreamCollector = projectindexwire.ProjectIndexArtifactStreamCollector

var NewProjectIndexPatchStreamCollector = projectindexwire.NewProjectIndexPatchStreamCollector
var NewProjectIndexArtifactStreamCollector = projectindexwire.NewProjectIndexArtifactStreamCollector
