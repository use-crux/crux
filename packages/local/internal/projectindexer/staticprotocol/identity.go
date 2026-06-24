package staticprotocol

func SkeletonIdentity() RunIdentity {
	return RunIdentity{
		ProtocolVersion: Version,
		Compiler: VersionIdentity{
			Name:    "crux-native-static-skeleton",
			Version: "phase-3",
		},
		Oxc: VersionIdentity{
			Name:    "oxc-rust",
			Version: "phase-3",
		},
		PrimitiveManifest: DigestIdentity{
			Name:    "crux-first-party-primitives",
			Version: "phase-3",
		},
		RelationPolicy: DigestIdentity{
			Name:    "crux-relation-policy",
			Version: "phase-3",
		},
		ExtensionManifests: []DigestIdentity{},
		FirstPartyGraphRules: DigestIdentity{
			Name:    "crux-first-party-graph-rules",
			Version: "phase-3",
		},
		CompilerProjection: DigestIdentity{
			Name:    "crux-static-projection",
			Version: "phase-3",
		},
	}
}
