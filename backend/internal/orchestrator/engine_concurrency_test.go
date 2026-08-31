package orchestrator

import "testing"

func TestSetMaxConcurrent(t *testing.T) {
	e := NewEngine(newStore(t), nil, 2)
	if cap(e.getSem()) != 2 {
		t.Fatalf("initial cap = %d", cap(e.getSem()))
	}
	e.SetMaxConcurrent(5)
	if cap(e.getSem()) != 5 {
		t.Fatalf("after resize cap = %d", cap(e.getSem()))
	}
	e.SetMaxConcurrent(0)
	if e.getSem() != nil {
		t.Fatal("expected nil sem for unlimited")
	}
}
