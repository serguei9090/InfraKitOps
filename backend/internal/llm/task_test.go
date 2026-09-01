package llm

import (
	"strings"
	"testing"
)

func TestRenderTask(t *testing.T) {
	task := Task{SystemTemplate: "rewrite {{context.text}} for {{context.promptName}} — note: {{input}} — {{unknown}}"}
	got := RenderTask(task, map[string]string{"text": "hello"}, "be terse")
	want := "rewrite hello for  — note: be terse — {{unknown}}" // missing context.promptName → blank
	if got != want {
		t.Fatalf("got %q", got)
	}
}

func TestExtractJSON(t *testing.T) {
	cases := map[string]string{
		"here you go:\n```json\n{\"a\":1}\n```\nthanks":  `{"a":1}`,
		"prose {\"name\":\"x\",\"script\":\"echo\"} more": `{"name":"x","script":"echo"}`,
		"[1, 2, 3] tail":                                  `[1, 2, 3]`,
		"no json here":                                    "",
		"{ broken":                                        "",
	}
	for in, want := range cases {
		if got := extractJSON(in); got != want {
			t.Errorf("extractJSON(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestTaskCRUDAndOverride(t *testing.T) {
	s := newStore(t)

	list, err := s.ListTasks("")
	if err != nil {
		t.Fatal(err)
	}
	if len(list) != len(Builtins()) {
		t.Fatalf("fresh list = %d, want %d builtins", len(list), len(Builtins()))
	}
	for _, tk := range list {
		if !tk.Builtin || tk.Overridden {
			t.Fatalf("builtin flags wrong: %+v", tk)
		}
	}

	// override a builtin
	if _, err := s.PutTask("", Task{ID: "prompt.improve", Title: "My Improve", SystemTemplate: "custom {{input}}"}); err != nil {
		t.Fatal(err)
	}
	got, _ := s.GetTask("", "prompt.improve")
	if got.Title != "My Improve" || !got.Builtin || !got.Overridden {
		t.Fatalf("override resolve = %+v", got)
	}

	// a brand-new custom task
	if _, err := s.PutTask("", Task{ID: "my.thing", Title: "Mine", SystemTemplate: "{{input}}"}); err != nil {
		t.Fatal(err)
	}
	list, _ = s.ListTasks("")
	if len(list) != len(Builtins())+1 {
		t.Fatalf("list after custom = %d", len(list))
	}

	// invalid task rejected
	if _, err := s.PutTask("", Task{ID: "bad"}); err == nil {
		t.Fatal("expected validation error")
	}

	// delete override → reverts to builtin
	if err := s.DeleteTask("", "prompt.improve"); err != nil {
		t.Fatal(err)
	}
	got, _ = s.GetTask("", "prompt.improve")
	if got.Overridden || !strings.Contains(got.SystemTemplate, "prompt engineer") {
		t.Fatalf("did not revert to builtin: %+v", got)
	}

	// delete a non-existent custom row
	if err := s.DeleteTask("", "prompt.improve"); err != ErrNotFound {
		t.Fatalf("want ErrNotFound, got %v", err)
	}
}

func TestTaskPreferredModelPersists(t *testing.T) {
	s := newStore(t)
	base, _ := s.GetTask("", "prompt.improve")
	base.PreferredConnectionID = "conn_x"
	base.PreferredModel = "fast-local"
	if _, err := s.PutTask("", *base); err != nil {
		t.Fatal(err)
	}
	got, _ := s.GetTask("", "prompt.improve")
	if got.PreferredConnectionID != "conn_x" || got.PreferredModel != "fast-local" || !got.Overridden {
		t.Fatalf("preferred not persisted: %+v", got)
	}
}

func TestSettingsRoundTrip(t *testing.T) {
	s := newStore(t)
	_ = s.PutSetting("defaultConnectionId", "conn_a")
	_ = s.PutSetting("defaultModel", "gpt-4o")
	m := s.GetSettings()
	if m["defaultConnectionId"] != "conn_a" || m["defaultModel"] != "gpt-4o" {
		t.Fatalf("settings = %v", m)
	}
}
