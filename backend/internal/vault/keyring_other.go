//go:build !windows

// Non-Windows stub for the "remember the vault key on this device" feature
// (R4d). A macOS Keychain / libsecret backing can be added later; until then
// these platforms report the keyring as unsupported and the UI hides the
// option. See RUNBOOK_MODULE_PLAN.md §5.2.
package vault

const keyringSupported = false

func keyringSet(string, []byte) error   { return errKeyringUnsupported }
func keyringGet(string) ([]byte, error) { return nil, errKeyringUnsupported }
func keyringDelete(string) error        { return errKeyringUnsupported }
