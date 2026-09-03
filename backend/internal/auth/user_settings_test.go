package auth

import (
	"encoding/json"
	"testing"
)

func TestUserSettingsBlob(t *testing.T) {
	s := newTestStore(t)
	u, err := s.CreateUser("alice", "", "correct horse battery", RoleOperator)
	if err != nil {
		t.Fatal(err)
	}

	// Missing → "{}".
	got, err := s.GetUserSettings(u.ID)
	if err != nil || string(got) != "{}" {
		t.Fatalf("empty: %q %v", got, err)
	}

	// Merge two patches.
	if _, err := s.PutUserSettings(u.ID, map[string]json.RawMessage{
		"theme": json.RawMessage(`"dark"`),
	}); err != nil {
		t.Fatal(err)
	}
	merged, err := s.PutUserSettings(u.ID, map[string]json.RawMessage{
		"shortcuts": json.RawMessage(`{"save":"mod+s"}`),
	})
	if err != nil {
		t.Fatal(err)
	}
	var m map[string]json.RawMessage
	if err := json.Unmarshal(merged, &m); err != nil {
		t.Fatal(err)
	}
	if string(m["theme"]) != `"dark"` || string(m["shortcuts"]) != `{"save":"mod+s"}` {
		t.Fatalf("merged wrong: %s", merged)
	}

	// null deletes a key.
	after, _ := s.PutUserSettings(u.ID, map[string]json.RawMessage{"theme": json.RawMessage(`null`)})
	var m2 map[string]json.RawMessage
	if err := json.Unmarshal(after, &m2); err != nil {
		t.Fatal(err)
	}
	if _, ok := m2["theme"]; ok {
		t.Fatalf("null did not delete: %s", after)
	}
	if string(m2["shortcuts"]) != `{"save":"mod+s"}` {
		t.Fatalf("null delete clobbered other keys: %s", after)
	}

	// Deleting the user drops the blob.
	if err := s.DeleteUser(u.ID); err != nil {
		t.Fatal(err)
	}
	var n int
	_ = s.db.QueryRow(`SELECT count(*) FROM auth_user_settings WHERE user_id = ?`, u.ID).Scan(&n)
	if n != 0 {
		t.Fatalf("orphan settings row after user delete")
	}
}
