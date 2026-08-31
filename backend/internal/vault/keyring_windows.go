//go:build windows

// OS keyring backing for "remember the vault key on this device" (R4d), using
// the Windows Credential Manager (advapi32 CredWrite/CredRead/CredDelete). The
// blob stored is the 32-byte AES key — the Credential Manager encrypts it at
// rest, scoped to the current Windows user. No new Go dependency: this calls
// the Win32 API directly.
package vault

import (
	"syscall"
	"unsafe"
)

var (
	modadvapi32     = syscall.NewLazyDLL("advapi32.dll")
	procCredWriteW  = modadvapi32.NewProc("CredWriteW")
	procCredReadW   = modadvapi32.NewProc("CredReadW")
	procCredDeleteW = modadvapi32.NewProc("CredDeleteW")
	procCredFree    = modadvapi32.NewProc("CredFree")
)

const (
	credTypeGeneric         = 1
	credPersistLocalMachine = 2
	errorNotFound           = syscall.Errno(1168)
)

type winCredential struct {
	Flags              uint32
	Type               uint32
	TargetName         *uint16
	Comment            *uint16
	LastWritten        syscall.Filetime
	CredentialBlobSize uint32
	CredentialBlob     *byte
	Persist            uint32
	AttributeCount     uint32
	Attributes         uintptr
	TargetAlias        *uint16
	UserName           *uint16
}

const keyringSupported = true

func keyringSet(target string, blob []byte) error {
	t, err := syscall.UTF16PtrFromString(target)
	if err != nil {
		return err
	}
	var blobPtr *byte
	if len(blob) > 0 {
		blobPtr = &blob[0]
	}
	cred := winCredential{
		Type:               credTypeGeneric,
		TargetName:         t,
		CredentialBlobSize: uint32(len(blob)),
		CredentialBlob:     blobPtr,
		Persist:            credPersistLocalMachine,
	}
	r, _, e := procCredWriteW.Call(uintptr(unsafe.Pointer(&cred)), 0)
	if r == 0 {
		return e
	}
	return nil
}

func keyringGet(target string) ([]byte, error) {
	t, err := syscall.UTF16PtrFromString(target)
	if err != nil {
		return nil, err
	}
	var pcred *winCredential
	r, _, e := procCredReadW.Call(
		uintptr(unsafe.Pointer(t)), credTypeGeneric, 0, uintptr(unsafe.Pointer(&pcred)),
	)
	if r == 0 {
		if e == errorNotFound {
			return nil, errKeyringMissing
		}
		return nil, e
	}
	defer procCredFree.Call(uintptr(unsafe.Pointer(pcred)))
	if pcred.CredentialBlobSize == 0 || pcred.CredentialBlob == nil {
		return nil, errKeyringMissing
	}
	out := make([]byte, pcred.CredentialBlobSize)
	copy(out, unsafe.Slice(pcred.CredentialBlob, pcred.CredentialBlobSize))
	return out, nil
}

func keyringDelete(target string) error {
	t, err := syscall.UTF16PtrFromString(target)
	if err != nil {
		return err
	}
	r, _, e := procCredDeleteW.Call(uintptr(unsafe.Pointer(t)), credTypeGeneric, 0)
	if r == 0 && e != errorNotFound {
		return e
	}
	return nil
}
