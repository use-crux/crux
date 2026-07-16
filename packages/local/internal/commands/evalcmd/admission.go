package evalcmd

import (
	"bufio"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"os/exec"
	"strings"

	"github.com/spf13/cobra"
	"github.com/use-crux/crux/packages/local/internal/assets"
	"github.com/use-crux/crux/packages/local/internal/projectroot"
)

func inspectAdmission(cwd string, args []string) (needsConfirmation, blocked bool, err error) {
	node, err := assets.FindNode()
	if err != nil {
		return false, false, err
	}
	worker, err := assets.ExtractEmbeddedEvalCoordinator()
	if err != nil {
		return false, false, err
	}
	child := exec.Command(node, append([]string{"--import", "tsx/esm", worker}, append(args, "--plan")...)...)
	child.Env = os.Environ()
	if cwd == "" {
		cwd = projectroot.Dir()
	}
	child.Dir = cwd
	stdout, err := child.StdoutPipe()
	if err != nil {
		return false, false, err
	}
	stderr, err := child.StderrPipe()
	if err != nil {
		return false, false, err
	}
	if err := child.Start(); err != nil {
		return false, false, err
	}
	go func() { _, _ = io.Copy(io.Discard, stderr) }()
	scanner := bufio.NewScanner(stdout)
	for scanner.Scan() {
		var event struct {
			Type string `json:"type"`
			Plan struct {
				Preflight struct {
					Status string `json:"status"`
				} `json:"preflight"`
				Cost struct {
					Admission struct {
						Status string `json:"status"`
					} `json:"admission"`
				} `json:"cost"`
			} `json:"plan"`
		}
		if json.Unmarshal(scanner.Bytes(), &event) == nil && event.Type == "eval:plan" {
			blocked = blocked || event.Plan.Preflight.Status == "blocked"
			needsConfirmation = needsConfirmation || event.Plan.Cost.Admission.Status == "confirmation_required"
		}
	}
	if scanErr := scanner.Err(); scanErr != nil {
		return false, false, scanErr
	}
	if waitErr := child.Wait(); waitErr != nil {
		return false, false, fmt.Errorf("Eval admission planning failed: %w", waitErr)
	}
	return needsConfirmation, blocked, nil
}

func confirmUnknownCost(cmd *cobra.Command) (bool, error) {
	_, _ = fmt.Fprint(cmd.ErrOrStderr(), "Eval has external actions with unknown maximum cost. Continue? [y/N] ")
	answer, err := bufio.NewReader(os.Stdin).ReadString('\n')
	if err != nil && len(answer) == 0 {
		return false, err
	}
	answer = strings.ToLower(strings.TrimSpace(answer))
	return answer == "y" || answer == "yes", nil
}
