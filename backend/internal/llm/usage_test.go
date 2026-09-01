package llm

import (
	"testing"
	"time"
)

func TestUsageAggregate(t *testing.T) {
	s := newStore(t)
	u, err := NewUsageStore(s.DB())
	if err != nil {
		t.Fatal(err)
	}

	u.Record("c1", "prompt.improve", "gpt-4o", 100, 20)
	u.Record("c1", "prompt.improve", "gpt-4o", 200, 30)
	u.Record("c1", "", "gpt-4o-mini", 50, 10) // playground
	u.Record("c2", "", "llama3.1:8b", 0, 0)   // zero → dropped

	since := time.Now().Add(-time.Hour).UnixMilli()

	byModel, err := u.Aggregate(since, "model")
	if err != nil {
		t.Fatal(err)
	}
	// gpt-4o (330 tok) should sort before gpt-4o-mini (60 tok)
	if len(byModel) != 2 || byModel[0].Key != "gpt-4o" {
		t.Fatalf("byModel = %+v", byModel)
	}
	if byModel[0].Calls != 2 || byModel[0].PromptTokens != 300 || byModel[0].CompletionTokens != 50 {
		t.Fatalf("gpt-4o bucket wrong: %+v", byModel[0])
	}

	byTask, err := u.Aggregate(since, "task")
	if err != nil {
		t.Fatal(err)
	}
	var seenPlayground bool
	for _, g := range byTask {
		if g.Key == "(playground)" {
			seenPlayground = true
		}
	}
	if !seenPlayground {
		t.Fatalf("byTask missing (playground): %+v", byTask)
	}

	// window excludes old rows
	empty, _ := u.Aggregate(time.Now().Add(time.Hour).UnixMilli(), "model")
	if len(empty) != 0 {
		t.Fatalf("future window should be empty: %+v", empty)
	}
}
