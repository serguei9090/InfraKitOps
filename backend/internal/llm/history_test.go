package llm

import (
	"encoding/json"
	"testing"
)

func TestHistoryRoundTrip(t *testing.T) {
	s := newStore(t)
	h, err := NewHistory(s.DB())
	if err != nil {
		t.Fatal(err)
	}

	steps, _ := json.Marshal([]map[string]any{{"id": "c1", "name": "srv__echo", "done": true}})
	msgs := []StoredMessage{
		{Role: "user", Content: "hi"},
		{Role: "assistant", Content: "hello", Steps: steps},
	}
	id, err := h.Save(Conversation{Title: "First chat", ConnID: "c1", Model: "m"}, msgs)
	if err != nil || id == "" {
		t.Fatalf("save: %v id=%q", err, id)
	}

	list, err := h.List()
	if err != nil || len(list) != 1 || list[0].Title != "First chat" {
		t.Fatalf("list: %v %+v", err, list)
	}

	conv, got, err := h.Get(id)
	if err != nil {
		t.Fatal(err)
	}
	if conv.Model != "m" || len(got) != 2 || got[1].Content != "hello" || len(got[1].Steps) == 0 {
		t.Fatalf("get mismatch: %+v / %+v", conv, got)
	}

	// rename + pin
	title := "Renamed"
	pinned := true
	if err := h.Patch(id, &title, &pinned); err != nil {
		t.Fatal(err)
	}
	list, _ = h.List()
	if list[0].Title != "Renamed" || !list[0].Pinned {
		t.Fatalf("patch not applied: %+v", list[0])
	}

	// replace messages (same id)
	if _, err := h.Save(Conversation{ID: id, Title: "Renamed", Model: "m2"}, msgs[:1]); err != nil {
		t.Fatal(err)
	}
	_, got, _ = h.Get(id)
	if len(got) != 1 {
		t.Fatalf("replace kept %d messages", len(got))
	}

	if err := h.Delete(id); err != nil {
		t.Fatal(err)
	}
	if _, _, err := h.Get(id); err != ErrNotFound {
		t.Fatalf("want ErrNotFound after delete, got %v", err)
	}
}
