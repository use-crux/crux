package devtools

// workspaceOperationClass describes the read-model boundary affected by an
// observed Workspace operation. Snapshot operations are aggregate lifecycle
// records even when their runtime implementation reads or mutates live files.
type workspaceOperationClass string

const (
	workspaceOperationFileRead                 workspaceOperationClass = "file-read"
	workspaceOperationFileMutation             workspaceOperationClass = "file-mutation"
	workspaceOperationSnapshotAccess           workspaceOperationClass = "snapshot-access"
	workspaceOperationSnapshotLiveTreeMutation workspaceOperationClass = "snapshot-live-tree-mutation"
	workspaceOperationSnapshotStorageMutation  workspaceOperationClass = "snapshot-storage-mutation"
	workspaceOperationAggregate                workspaceOperationClass = "aggregate"
)

func classifyWorkspaceOperation(operation string) workspaceOperationClass {
	switch operation {
	case "read", "exists", "stat", "history", "diff":
		return workspaceOperationFileRead
	case "write", "edit", "delete", "append", "rename", "move", "copy", "undo", "finalize":
		return workspaceOperationFileMutation
	case "snapshot.create", "snapshot.list":
		return workspaceOperationSnapshotAccess
	case "snapshot.restore":
		return workspaceOperationSnapshotLiveTreeMutation
	case "snapshot.delete":
		return workspaceOperationSnapshotStorageMutation
	default:
		return workspaceOperationAggregate
	}
}

func workspaceOperationAffectsFileCatalog(operation string) bool {
	class := classifyWorkspaceOperation(operation)
	return class == workspaceOperationFileRead || class == workspaceOperationFileMutation
}

func isWorkspaceSnapshotOperation(operation string) bool {
	class := classifyWorkspaceOperation(operation)
	return class == workspaceOperationSnapshotAccess ||
		class == workspaceOperationSnapshotLiveTreeMutation ||
		class == workspaceOperationSnapshotStorageMutation
}
