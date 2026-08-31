package vault

import (
	"testing"
)

func TestKeyringRememberUnlockForget(t *testing.T) {
	if !keyringSupported {
		t.Skip("OS keyring not supported on this platform")
	}
	v := newVault(t)
	if err := v.Init("hunter2!"); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = v.Forget() })

	if v.Status().KeyringRemembered {
		t.Fatal("fresh vault should not be remembered")
	}
	if err := v.Remember(); err != nil {
		t.Fatalf("remember: %v", err)
	}
	if !v.Status().KeyringRemembered {
		t.Fatal("Status should report the key as remembered")
	}

	// Lock, then unlock straight from the keyring — no password.
	v.Lock()
	if v.Status().Unlocked {
		t.Fatal("still unlocked after Lock")
	}
	if err := v.UnlockWithKeyring(); err != nil {
		t.Fatalf("UnlockWithKeyring: %v", err)
	}
	if !v.Status().Unlocked {
		t.Fatal("keyring unlock did not unlock")
	}

	// A brand-new handle over the same file auto-unlocks from the keyring.
	v2, err := Open(v.path, 0)
	if err != nil {
		t.Fatal(err)
	}
	if !v2.Status().Unlocked {
		t.Fatal("re-Open should have auto-unlocked from the keyring")
	}

	if err := v.Forget(); err != nil {
		t.Fatalf("forget: %v", err)
	}
	if v.Status().KeyringRemembered {
		t.Fatal("still remembered after Forget")
	}
	v.Lock()
	if err := v.UnlockWithKeyring(); err != ErrNoKeyring {
		t.Fatalf("want ErrNoKeyring after Forget, got %v", err)
	}
}
