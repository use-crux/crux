package projectindex

import "github.com/use-crux/crux/packages/local/internal/projectindex/manifestcontract"

type ProjectIndexDeploymentManifest = manifestcontract.DeploymentManifest
type ProjectIndexManifestContent = manifestcontract.ManifestContent
type ProjectIndexManifestDefinition = manifestcontract.ManifestDefinition
type ProjectIndexManifestSourceRef = manifestcontract.ManifestSourceRef
type ProjectIndexManifestSource = manifestcontract.ManifestSource
type ProjectIndexManifestFingerprints = manifestcontract.ManifestFingerprints
type ProjectIndexManifestRelation = manifestcontract.ManifestRelation
type ProjectIndexManifestProvenance = manifestcontract.ManifestProvenance

// ParseDeploymentManifest strictly decodes one TypeScript-produced artifact.
func ParseDeploymentManifest(artifact []byte) (ProjectIndexDeploymentManifest, error) {
	return manifestcontract.Parse(artifact)
}

// VerifyDeploymentManifest recomputes the TypeScript canonical content digest.
func VerifyDeploymentManifest(manifest ProjectIndexDeploymentManifest) error {
	return manifestcontract.Verify(manifest)
}
