package protocol

func StaticIndexIdentityManifest() IdentityManifest {
	return IdentityManifest{
		ProtocolVersion: Version,
		Compiler: VersionIdentity{
			Name:    "crux-indexer-static-compiler",
			Version: "phase-3",
		},
		OxcFrontend: VersionIdentity{
			Name:    "oxc-rust",
			Version: "oxc_parser@0.139.0+crux_native_group3.10",
		},
		PrimitiveManifest: DigestIdentity{
			Name:    "crux-first-party-primitives",
			Version: "3",
			Digest:  "sha256:primitive-manifest",
		},
		RelationPolicy: DigestIdentity{
			Name:    "runtime-relation-specs",
			Version: "1",
			Digest:  "sha256:relation-policy",
		},
		RuleDescriptors: DigestIdentity{
			Name:    "crux-indexer-rule-descriptors",
			Version: "1",
			Digest:  "sha256:rule-descriptors",
		},
		CompilerProjection: DigestIdentity{
			Name:    "crux-static-projection",
			Version: "1",
			Digest:  "sha256:compiler-projection",
		},
	}
}

func SkeletonIdentity() RunIdentity {
	manifest := StaticIndexIdentityManifest()
	return RunIdentity{
		ProtocolVersion:    manifest.ProtocolVersion,
		Compiler:           manifest.Compiler,
		Oxc:                manifest.OxcFrontend,
		PrimitiveManifest:  manifest.PrimitiveManifest,
		RelationPolicy:     manifest.RelationPolicy,
		ExtensionManifests: []DigestIdentity{},
		RuleDescriptors:    manifest.RuleDescriptors,
		CompilerProjection: manifest.CompilerProjection,
	}
}
