package llm

import (
	"strings"

	"github.com/infrakit/backend/internal/templating"
)

// TaskOutputShape tells the UI how to render a task result.
type TaskOutputShape string

const (
	OutputText TaskOutputShape = "text" // free text
	OutputDiff TaskOutputShape = "diff" // rewrite of context.text — show a diff + accept/reject
	OutputJSON TaskOutputShape = "json" // fenced JSON — the engine also emits a `parsed` event
)

// Task is a named, grounded unit of work — the "grounding connector" of
// AI_MODULE_PLAN.md §4. Built-in tasks ship in Go; a custom row of the same id
// overrides one.
type Task struct {
	ID             string          `json:"id"`
	Title          string          `json:"title"`
	Description    string          `json:"description,omitempty"`
	Builtin        bool            `json:"builtin"`
	Overridden     bool            `json:"overridden,omitempty"` // builtin with a custom override present
	SystemTemplate string          `json:"systemTemplate"`
	InputLabel     string          `json:"inputLabel,omitempty"`
	OutputShape    TaskOutputShape `json:"outputShape"`
	SuggestedModel string          `json:"suggestedModel,omitempty"`
	Temperature    *float64        `json:"temperature,omitempty"`
	// Preferred connection + model for this task — a custom-override field, set
	// from Settings. The frontend uses it in its fallback chain
	// (SETTINGS_MODULE_PLAN.md §5.2).
	PreferredConnectionID string `json:"preferredConnectionId,omitempty"`
	PreferredModel        string `json:"preferredModel,omitempty"`

	// Tools opts this task into MCP tools (A4d): a list of mcp_server ids, or
	// the single element "all". Empty → no tools. Read-only tools auto-run;
	// others prompt for approval (A4c).
	Tools []string `json:"tools,omitempty"`
}

func f64(v float64) *float64 { return &v }

// Builtins is the shipped task set. Ids are `<domain>.<verb>`; templates read
// `{{context.*}}` (caller-supplied) and `{{input}}` (the user's instruction).
func Builtins() []Task {
	return []Task{
		{
			ID:          "prompt.improve",
			Title:       "Improve prompt",
			Description: "Rewrite a prompt or message for clarity, specificity and structure.",
			OutputShape: OutputDiff,
			InputLabel:  "What to change (optional)",
			Temperature: f64(0.3),
			SystemTemplate: `You are an expert prompt engineer. Rewrite the text below to be clearer,
more specific, and better structured for a large language model, WITHOUT
changing its intent. Keep the author's voice. Return ONLY the rewritten text —
no preamble, no explanation, no code fences.

--- TEXT ({{context.promptName}}) ---
{{context.text}}
--- END TEXT ---

Extra instruction from the author: {{input}}`,
		},
		{
			ID:          "prompt.draft",
			Title:       "Draft a prompt",
			Description: "Write a new prompt from a one-line goal.",
			OutputShape: OutputText,
			InputLabel:  "Goal",
			Temperature: f64(0.5),
			SystemTemplate: `You are an expert prompt engineer. Write a single, ready-to-use prompt for a
large language model that accomplishes the goal below. Be specific about the
task, the desired output format, and any constraints. Return ONLY the prompt.

Goal: {{input}}
Style / tone: {{context.style}}`,
		},
		{
			ID:          "command.explain",
			Title:       "Explain a command",
			Description: "Explain what a shell / SSH command does and flag anything risky.",
			OutputShape: OutputText,
			InputLabel:  "Question (optional)",
			Temperature: f64(0.2),
			SystemTemplate: `Explain, concisely, what the following {{context.shell}} command does. Call out
anything destructive, irreversible, or that needs elevated privileges. Use short
bullet points.

    {{context.command}}

{{input}}`,
		},
		{
			ID:          "runbook.gen-step",
			Title:       "Generate a runbook step",
			Description: "Turn an intent into a {name, script} step.",
			OutputShape: OutputJSON,
			InputLabel:  "What the step should do",
			Temperature: f64(0.2),
			SystemTemplate: `Produce one runbook step as JSON: {"name": "...", "script": "..."} for a
{{context.executor}} executor. The script must be runnable as-is. Use
{{VAR}} placeholders for anything the operator should supply. Return ONLY the
JSON object, in a fenced code block.

Intent: {{input}}
Earlier steps (context): {{context.priorSteps}}`,
		},
		{
			ID:          "runbook.fix-step",
			Title:       "Fix a failing step",
			Description: "Given a failed step and its error, propose a corrected script.",
			OutputShape: OutputDiff,
			InputLabel:  "Extra context (optional)",
			Temperature: f64(0.2),
			SystemTemplate: `A runbook step failed. Propose a corrected script. Return ONLY the corrected
script text — no explanation, no fences.

--- SCRIPT ---
{{context.script}}
--- ERROR ---
{{context.error}}
--- END ---

{{input}}`,
		},
		{
			ID:          "runbook.assistant",
			Title:       "Runbook assistant",
			Description: "Chat about the current runbook — understand it, debug it, improve it.",
			OutputShape: OutputText,
			InputLabel:  "Ask about this runbook",
			Temperature: f64(0.3),
			SystemTemplate: `You are an assistant for InfraKit Studio Runbooks — reusable, versioned,
multi-step command runbooks (shell / SSH / HTTP / Python steps, {{VAR}} args,
{{secret:NAME}} refs). Help the operator understand, debug, and improve the
runbook below. Be concise and practical. When you suggest a script, keep it
copy-pasteable.

--- RUNBOOK (JSON) ---
{{context.runbook}}
--- END ---`,
		},
		{
			ID:          "ansible.gen-playbook",
			Title:       "Generate an Ansible playbook",
			Description: "Turn an intent into a runnable playbook YAML.",
			OutputShape: OutputText,
			InputLabel:  "What the playbook should do",
			Temperature: f64(0.2),
			SystemTemplate: `Write one complete Ansible playbook (YAML, a list of plays) that does what
is asked. Use fully-qualified module names (ansible.builtin.*). Prefer
idempotent modules over command/shell. Add ` + "`become: true`" + ` only where
root is genuinely needed. Return ONLY the YAML, in a fenced ` + "```yaml" + ` block,
no prose.

--- CURRENT FILE (may be empty) ---
{{context.playbook}}
--- END ---

Intent: {{input}}`,
		},
		{
			ID:          "ansible.explain-task",
			Title:       "Explain this Ansible content",
			Description: "Explain what a play / task / role does and flag risks.",
			OutputShape: OutputText,
			InputLabel:  "Anything specific to focus on (optional)",
			Temperature: f64(0.3),
			SystemTemplate: `Explain concisely what the Ansible content below does — play by play, then
task by task. Call out anything destructive, non-idempotent, or that needs
privilege escalation. Note undefined variables if you see any.

--- ANSIBLE (YAML) ---
{{context.playbook}}
--- END ---

{{input}}`,
		},
	}
}

// RenderTask fills a task's system template from the caller's context map and
// the user's input string. `{{input}}` and every `{{context.*}}` slot always
// resolve — a context key the caller did not supply becomes empty rather than
// leaking the literal token into the prompt. Other tokens are left untouched.
func RenderTask(t Task, context map[string]string, input string) string {
	return templating.Substitute(t.SystemTemplate, func(name string) (string, bool) {
		if name == "input" {
			return input, true
		}
		if strings.HasPrefix(name, "context.") {
			return context[strings.TrimPrefix(name, "context.")], true
		}
		return "", false
	})
}
