package auth

import (
	"path/filepath"
	"testing"
	"time"
)

func newTestStore(t *testing.T) *Store {
	t.Helper()
	s, err := Open("file:" + filepath.Join(t.TempDir(), "auth.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { s.Close() })
	return s
}

func TestPasswordHashVerify(t *testing.T) {
	h, err := hashPassword("correct horse battery staple")
	if err != nil {
		t.Fatal(err)
	}
	if !verifyPassword("correct horse battery staple", h) {
		t.Fatal("valid password rejected")
	}
	if verifyPassword("wrong", h) {
		t.Fatal("wrong password accepted")
	}
	if verifyPassword("x", "$argon2id$broken") {
		t.Fatal("malformed hash accepted")
	}
}

func TestUserCRUDAndLastAdmin(t *testing.T) {
	s := newTestStore(t)

	if _, err := s.CreateUser("a", "", "short", RoleAdmin); err != ErrWeakPassword {
		t.Fatalf("want ErrWeakPassword, got %v", err)
	}
	admin, err := s.CreateUser("admin", "", "a-strong-password", RoleAdmin)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.CreateUser("admin", "", "another-password", RoleOperator); err != ErrTaken {
		t.Fatalf("want ErrTaken, got %v", err)
	}

	// can't demote or delete the only admin
	op := RoleOperator
	if _, err := s.UpdateUser(admin.ID, UserPatch{Role: &op}); err != ErrLastAdmin {
		t.Fatalf("demote last admin: want ErrLastAdmin, got %v", err)
	}
	if err := s.DeleteUser(admin.ID); err != ErrLastAdmin {
		t.Fatalf("delete last admin: want ErrLastAdmin, got %v", err)
	}

	// a second admin unblocks removal of one of them
	admin2, err := s.CreateUser("admin2", "", "a-second-strong-pw", RoleAdmin)
	if err != nil {
		t.Fatal(err)
	}
	if err := s.DeleteUser(admin2.ID); err != nil {
		t.Fatalf("delete admin2 with 2 admins: %v", err)
	}
	// back to one admin → demote blocked again
	if _, err := s.UpdateUser(admin.ID, UserPatch{Role: &op}); err != ErrLastAdmin {
		t.Fatalf("demote sole admin again: want ErrLastAdmin, got %v", err)
	}

	list, err := s.ListUsers()
	if err != nil || len(list) != 1 {
		t.Fatalf("list: %v n=%d", err, len(list))
	}
}

func TestSessionLifecycle(t *testing.T) {
	s := newTestStore(t)
	u, _ := s.CreateUser("u", "", "the-password-123", RoleOperator)

	tok, err := s.CreateSession(u.ID, "test-agent")
	if err != nil {
		t.Fatal(err)
	}
	_, got, err := s.LookupSession(tok)
	if err != nil || got.ID != u.ID {
		t.Fatalf("lookup: %v %+v", err, got)
	}

	// disabled user's session stops resolving
	dis := true
	if _, err := s.UpdateUser(u.ID, UserPatch{Disabled: &dis}); err != nil {
		t.Fatal(err)
	}
	if _, _, err := s.LookupSession(tok); err == nil {
		t.Fatal("disabled user session still valid")
	}

	// password change wipes sessions
	en := false
	_, _ = s.UpdateUser(u.ID, UserPatch{Disabled: &en})
	tok2, _ := s.CreateSession(u.ID, "")
	np := "brand-new-password"
	if _, err := s.UpdateUser(u.ID, UserPatch{Password: &np}); err != nil {
		t.Fatal(err)
	}
	if _, _, err := s.LookupSession(tok2); err == nil {
		t.Fatal("session survived password change")
	}
}

func TestThrottle(t *testing.T) {
	th := newThrottle()
	now := time.Now()
	th.now = func() time.Time { return now }

	for i := 0; i < 2; i++ {
		if !th.allowed("k") {
			t.Fatalf("blocked too early at %d", i)
		}
		th.fail("k")
	}
	// 3rd failure triggers a block
	th.fail("k")
	if th.allowed("k") {
		t.Fatal("not blocked after 3 fails")
	}
	now = now.Add(2 * time.Second)
	if !th.allowed("k") {
		t.Fatal("still blocked after backoff elapsed")
	}
	th.ok("k")
	if _, ok := th.entries["k"]; ok {
		t.Fatal("ok() did not clear the entry")
	}
}

func TestServiceBootstrapAndLogin(t *testing.T) {
	s := newTestStore(t)
	svc, err := NewService(s)
	if err != nil {
		t.Fatal(err)
	}
	if !svc.NeedsBootstrap() {
		t.Fatal("fresh store should need bootstrap")
	}

	if _, _, err := svc.Bootstrap("wrong-token", "admin", "a-strong-password", ""); err != ErrBadSetupToken {
		t.Fatalf("bad token: want ErrBadSetupToken, got %v", err)
	}
	sess, admin, err := svc.Bootstrap(svc.SetupToken(), "admin", "a-strong-password", "agent")
	if err != nil {
		t.Fatal(err)
	}
	if admin.Role != RoleAdmin || sess == "" {
		t.Fatalf("bootstrap result: %+v %q", admin, sess)
	}
	if svc.NeedsBootstrap() {
		t.Fatal("setup token not spent")
	}
	if _, _, err := svc.Bootstrap("x", "admin2", "another-strong-pw", ""); err != ErrBootstrapDone {
		t.Fatalf("second bootstrap: want ErrBootstrapDone, got %v", err)
	}

	// login
	if _, _, err := svc.Login("admin", "wrong", "1.2.3.4", ""); err != ErrInvalidCredentials {
		t.Fatalf("bad login: %v", err)
	}
	tok, u, err := svc.Login("admin", "a-strong-password", "1.2.3.4", "agent")
	if err != nil || u.ID != admin.ID {
		t.Fatalf("login: %v %+v", err, u)
	}
	if got, err := svc.Validate(tok); err != nil || got.ID != admin.ID {
		t.Fatalf("validate: %v %+v", err, got)
	}

	// change password → old sessions dead, new token works
	newTok, err := svc.ChangePassword(admin, "a-strong-password", "yet-another-strong-pw", "agent")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := svc.Validate(tok); err == nil {
		t.Fatal("old session valid after password change")
	}
	if _, err := svc.Validate(newTok); err != nil {
		t.Fatalf("new session invalid: %v", err)
	}
}

func TestServiceLoginThrottle(t *testing.T) {
	s := newTestStore(t)
	svc, _ := NewService(s)
	_, _, _ = svc.Bootstrap(svc.SetupToken(), "admin", "a-strong-password", "")

	for i := 0; i < 5; i++ {
		_, _, _ = svc.Login("admin", "nope", "9.9.9.9", "")
	}
	if _, _, err := svc.Login("admin", "a-strong-password", "9.9.9.9", ""); err != ErrLockedOut {
		t.Fatalf("want ErrLockedOut after burst, got %v", err)
	}
	// a different IP is unaffected
	if _, _, err := svc.Login("admin", "a-strong-password", "1.1.1.1", ""); err != nil {
		t.Fatalf("other IP blocked: %v", err)
	}
}
