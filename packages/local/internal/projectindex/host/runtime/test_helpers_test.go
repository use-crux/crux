package runtime

import nodeprocess "github.com/use-crux/crux/packages/local/internal/process/node"

func findNodePath() (string, error) {
	return nodeprocess.FindNodePath()
}
