package ansible

import (
	"context"
	"os"
	"path/filepath"
	"runtime"
	"testing"
)

func TestScaffoldAndScanTree(t *testing.T) {
	dir := t.TempDir()
	proj := filepath.Join(dir, "demo")
	if err := Scaffold(proj); err != nil {
		t.Fatalf("Scaffold: %v", err)
	}
	// second scaffold into a non-empty dir must fail
	if err := Scaffold(proj); err == nil {
		t.Fatal("Scaffold into a non-empty dir should fail")
	}

	tree, err := ScanTree(proj)
	if err != nil {
		t.Fatalf("ScanTree: %v", err)
	}
	if !tree.HasConfig {
		t.Error("want HasConfig")
	}
	if !tree.HasReqs {
		t.Error("want HasReqs")
	}
	if !contains(tree.Playbooks, "site.yml") {
		t.Errorf("want site.yml in playbooks, got %v", tree.Playbooks)
	}
	if !contains(tree.Inventories, "inventory") {
		t.Errorf("want inventory dir, got %v", tree.Inventories)
	}
}

func TestLooksLikePlaybook(t *testing.T) {
	dir := t.TempDir()
	cases := map[string]struct {
		body string
		want bool
	}{
		"play":       {"- hosts: all\n  tasks: []\n", true},
		"import":     {"- import_playbook: other.yml\n", true},
		"role-list":  {"- hosts: web\n  roles: [nginx]\n", true},
		"plain-list": {"- one\n- two\n", false},
		"mapping":    {"key: value\n", false},
		"empty":      {"", false},
	}
	for name, c := range cases {
		p := filepath.Join(dir, name+".yml")
		if err := os.WriteFile(p, []byte(c.body), 0o644); err != nil {
			t.Fatal(err)
		}
		if got := looksLikePlaybook(p); got != c.want {
			t.Errorf("%s: looksLikePlaybook = %v, want %v", name, got, c.want)
		}
	}
}

func TestSafeJoin(t *testing.T) {
	root := filepath.Clean("/srv/proj")
	ok, err := safeJoin(root, "playbooks/site.yml")
	if err != nil || ok != filepath.Join(root, "playbooks", "site.yml") {
		t.Fatalf("safeJoin in-root: %v %v", ok, err)
	}
	if _, err := safeJoin(root, "../secret"); err == nil {
		t.Error("safeJoin should reject ../ escape")
	}
	if _, err := safeJoin(root, "playbooks/../../etc/passwd"); err == nil {
		t.Error("safeJoin should reject nested escape")
	}
}

func TestStoreProjectScoping(t *testing.T) {
	s := openTestStore(t)

	alice, _ := s.PutProject("alice", Project{Name: "a", Path: "/tmp/a"})
	if _, err := s.PutProject("bob", Project{Name: "b", Path: "/tmp/b"}); err != nil {
		t.Fatal(err)
	}

	// bob can't see alice's private project
	if _, err := s.GetProject("bob", alice.ID); err != ErrNotFound {
		t.Errorf("cross-user GetProject = %v, want ErrNotFound", err)
	}
	list, _ := s.ListProjects("bob")
	for _, p := range list {
		if p.ID == alice.ID {
			t.Error("bob's ListProjects leaked alice's project")
		}
	}
	// bob can't delete it either
	if err := s.DeleteProject("bob", alice.ID); err != ErrNotFound {
		t.Errorf("cross-user delete = %v, want ErrNotFound", err)
	}
	// alice can
	if err := s.DeleteProject("alice", alice.ID); err != nil {
		t.Errorf("owner delete: %v", err)
	}
}

func TestStoreClaimOrphans(t *testing.T) {
	s := openTestStore(t)
	orphan, _ := s.PutProject("", Project{Name: "legacy", Path: "/tmp/x"})
	if err := s.ClaimOrphans("admin"); err != nil {
		t.Fatal(err)
	}
	if _, err := s.GetProject("admin", orphan.ID); err != nil {
		t.Errorf("admin should own claimed orphan: %v", err)
	}
	if _, err := s.GetProject("someoneelse", orphan.ID); err != ErrNotFound {
		t.Errorf("orphan should now be private to admin, got %v", err)
	}
}

func TestStoreRuns(t *testing.T) {
	s := openTestStore(t)
	id, err := s.InsertRun(&Run{Owner: "alice", ProjectID: "p1", Playbook: "site.yml", Status: StatusRunning, Argv: "ansible-playbook site.yml", StartedAt: 1})
	if err != nil {
		t.Fatal(err)
	}
	if err := s.FinishRun(id, StatusOK, `{"e":"stats"}`, `{"hosts":{}}`); err != nil {
		t.Fatal(err)
	}
	run, err := s.GetRun("alice", id)
	if err != nil {
		t.Fatal(err)
	}
	if run.Status != StatusOK || run.Events == "" {
		t.Errorf("GetRun = %+v", run)
	}
	if _, err := s.GetRun("bob", id); err != ErrNotFound {
		t.Errorf("cross-user GetRun = %v, want ErrNotFound", err)
	}
	// list without the events blob
	runs, _ := s.ListRuns("alice", "p1", 10, false)
	if len(runs) != 1 || runs[0].Events != "" {
		t.Errorf("ListRuns(full=false) = %+v", runs)
	}
}

func TestRuntimeDetect(t *testing.T) {
	rt := NewRuntime(t.TempDir())
	caps := rt.Detect(context.Background(), RuntimeAuto)
	if caps.Runtime != RuntimeAuto {
		t.Errorf("Runtime = %q", caps.Runtime)
	}
	if caps.VenvPath == "" {
		t.Error("want a VenvPath")
	}
	// no ansible in a bare temp dir → not ready, with a reason
	if caps.Ready && caps.Reason == "" {
		// ok: a dev box may actually have ansible on PATH
		t.Log("ansible present on this host")
	}
	if _, ok := caps.System["ansible-playbook"]; !ok {
		t.Error("System map should always carry every wanted bin")
	}
}

func TestVenvBinDir(t *testing.T) {
	rt := NewRuntime("/cfg")
	got := rt.venvBinDir()
	want := filepath.Join("/cfg", "ansible-venv", "bin")
	if runtime.GOOS == "windows" {
		want = filepath.Join("/cfg", "ansible-venv", "Scripts")
	}
	if got != want {
		t.Errorf("venvBinDir = %q, want %q", got, want)
	}
}

func openTestStore(t *testing.T) *Store {
	t.Helper()
	s, err := Open("file:" + filepath.Join(t.TempDir(), "ansible.db"))
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	t.Cleanup(func() { _ = s.Close() })
	return s
}

func contains(ss []string, want string) bool {
	for _, s := range ss {
		if s == want {
			return true
		}
	}
	return false
}
