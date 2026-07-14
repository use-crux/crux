package projectindex

import "github.com/use-crux/crux/packages/local/internal/projectindex/eventwire"

type ProjectIndexPatchStreamOptions = eventwire.ProjectIndexPatchStreamOptions
type ProjectIndexPatchStreamCollector = eventwire.ProjectIndexPatchStreamCollector
type ProjectIndexPhaseTiming = eventwire.ProjectIndexPhaseTiming

type ProjectIndexArtifactKind = eventwire.ProjectIndexArtifactKind

const (
	ProjectIndexArtifactProjectModel                 = eventwire.ProjectIndexArtifactProjectModel
	ProjectIndexArtifactProjectConfig                = eventwire.ProjectIndexArtifactProjectConfig
	ProjectIndexArtifactStaticIndexConfig            = eventwire.ProjectIndexArtifactStaticIndexConfig
	ProjectIndexArtifactStaticSyntaxPlan             = eventwire.ProjectIndexArtifactStaticSyntaxPlan
	ProjectIndexArtifactStaticExtensionHostManifest  = eventwire.ProjectIndexArtifactStaticExtensionHostManifest
	ProjectIndexArtifactStaticExtensionEvidenceBatch = eventwire.ProjectIndexArtifactStaticExtensionEvidenceBatch
	ProjectIndexArtifactStaticRuleCheck              = eventwire.ProjectIndexArtifactStaticRuleCheck
	ProjectIndexArtifactRuntimeArtifacts             = eventwire.ProjectIndexArtifactRuntimeArtifacts
	ProjectIndexArtifactRuntimeOperation             = eventwire.ProjectIndexArtifactRuntimeOperation
	ProjectIndexArtifactSetupOperation               = eventwire.ProjectIndexArtifactSetupOperation
	ProjectIndexArtifactDeploymentManifest           = eventwire.ProjectIndexArtifactDeploymentManifest
)

type ProjectIndexArtifactStreamOptions = eventwire.ProjectIndexArtifactStreamOptions
type ProjectIndexArtifactStreamCollector = eventwire.ProjectIndexArtifactStreamCollector

var NewProjectIndexPatchStreamCollector = eventwire.NewProjectIndexPatchStreamCollector
var NewProjectIndexArtifactStreamCollector = eventwire.NewProjectIndexArtifactStreamCollector
