package evalrunner

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"regexp"
	"sort"
	"strings"
	"unicode/utf8"

	"github.com/use-crux/crux/packages/local/internal/assets"
	"github.com/use-crux/crux/packages/local/internal/process/workerproc"
)

type streamCoordinator func(context.Context, workerproc.OneShot, func(json.RawMessage) error) (workerproc.StreamResult, error)

const maxCoordinatorMessageBytes = 2048

var bearerPattern = regexp.MustCompile(`(?i)\bBearer\s+[^\s]+`)

// Coordinator runs the embedded coordinator against the user's installed Eval packages.
type Coordinator struct {
	ProjectRoot string
	FindNode    func() (string, error)
	Extract     func() (string, error)
	stream      streamCoordinator
}

// Run preserves the coordinator's planning, admission, execution, and persistence path.
func (c Coordinator) Run(ctx context.Context, request RunRequest) (RunResult, error) {
	if strings.TrimSpace(c.ProjectRoot) == "" {
		return RunResult{}, fmt.Errorf("run Eval: project root unavailable; start Crux from the project root")
	}
	node, script, err := c.dependencies()
	if err != nil {
		return RunResult{}, err
	}
	args := []string{request.EvalID}
	var input []byte
	if request.ConfirmUnknownCost {
		args = append(args, "--request-unknown-cost-confirmation")
		input = []byte("yes\n")
	} else {
		args = append(args, "--decline-unknown-cost-confirmation")
	}

	result := RunResult{EvalID: request.EvalID}
	stream := c.stream
	if stream == nil {
		stream = workerproc.Stream
	}
	process, err := stream(ctx, workerproc.OneShot{
		CommandPath: node,
		CommandArgs: []string{script},
		Args:        args,
		Dir:         c.ProjectRoot,
		Input:       input,
	}, func(raw json.RawMessage) error {
		var event struct {
			Type     string   `json:"type"`
			EvalID   string   `json:"evalId"`
			ExitCode int      `json:"exitCode"`
			Message  string   `json:"message"`
			RunIDs   []string `json:"runIds"`
			Run      struct {
				RunID  string `json:"runId"`
				Passed bool   `json:"passed"`
			} `json:"run"`
		}
		if err := json.Unmarshal(raw, &event); err != nil {
			return fmt.Errorf("decode Eval coordinator event: %w", err)
		}
		switch event.Type {
		case "error":
			if event.Message == "" {
				event.Message = "Eval coordinator rejected the run"
			}
			return fmt.Errorf("run Eval: %s", safeCoordinatorMessage(event.Message))
		case "eval:done":
			if event.EvalID == request.EvalID {
				result.RunID = event.Run.RunID
				result.Passed = event.Run.Passed
			}
		case "run:done":
			result.ExitCode = event.ExitCode
			result.RunIDs = append([]string(nil), event.RunIDs...)
		}
		return nil
	})
	if err != nil {
		return RunResult{}, err
	}
	if result.RunID == "" && len(result.RunIDs) > 0 {
		result.RunID = result.RunIDs[0]
	}
	if result.RunID == "" || len(result.RunIDs) == 0 {
		if process.ExitErr != nil {
			return RunResult{}, fmt.Errorf("Eval coordinator failed before producing a run")
		}
		return RunResult{}, fmt.Errorf("Eval coordinator returned no persisted run")
	}
	if process.ExitErr != nil && result.ExitCode != 1 {
		return RunResult{}, fmt.Errorf("Eval coordinator failed after execution")
	}
	return result, nil
}

func safeCoordinatorMessage(value string) string {
	value = strings.Join(strings.Fields(value), " ")
	value = bearerPattern.ReplaceAllString(value, "Bearer [redacted]")
	values := sensitiveEnvironmentValues()
	for _, secret := range values {
		value = strings.ReplaceAll(value, secret, "[redacted]")
	}
	if len(value) <= maxCoordinatorMessageBytes {
		return value
	}
	value = value[:maxCoordinatorMessageBytes]
	for !utf8.ValidString(value) {
		value = value[:len(value)-1]
	}
	return value + "…"
}

func sensitiveEnvironmentValues() []string {
	var values []string
	for _, entry := range os.Environ() {
		key, value, ok := strings.Cut(entry, "=")
		upper := strings.ToUpper(key)
		if !ok || len(value) < 4 ||
			(!strings.Contains(upper, "TOKEN") &&
				!strings.Contains(upper, "SECRET") &&
				!strings.Contains(upper, "PASSWORD") &&
				!strings.Contains(upper, "API_KEY") &&
				!strings.Contains(upper, "AUTH")) {
			continue
		}
		values = append(values, value)
	}
	sort.Slice(values, func(i, j int) bool { return len(values[i]) > len(values[j]) })
	return values
}

func (c Coordinator) dependencies() (string, string, error) {
	findNode := c.FindNode
	if findNode == nil {
		findNode = assets.FindNode
	}
	extract := c.Extract
	if extract == nil {
		extract = assets.ExtractEmbeddedEvalCoordinator
	}
	node, err := findNode()
	if err != nil {
		return "", "", err
	}
	script, err := extract()
	return node, script, err
}
