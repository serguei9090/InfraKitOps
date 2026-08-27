//go:build windows

package elevate

import (
	"fmt"
	"time"
	"unsafe"

	"golang.org/x/sys/windows"
)

var (
	shell32            = windows.NewLazySystemDLL("shell32.dll")
	procShellExecuteEx = shell32.NewProc("ShellExecuteExW")
)

const (
	seeMaskNoCloseProcess = 0x00000040
	swHide                = 0
)

type shellExecuteInfo struct {
	cbSize       uint32
	fMask        uint32
	hwnd         uintptr
	lpVerb       *uint16
	lpFile       *uint16
	lpParameters *uint16
	lpDirectory  *uint16
	nShow        int32
	hInstApp     uintptr
	lpIDList     uintptr
	lpClass      *uint16
	hkeyClass    uintptr
	dwHotKey     uint32
	hIcon        uintptr
	hProcess     windows.Handle
}

// runElevated launches the helper via ShellExecuteEx with the "runas" verb,
// which triggers the UAC consent prompt, and waits for it to exit.
func runElevated(helper, reqFile, respFile string) error {
	verb, _ := windows.UTF16PtrFromString("runas")
	file, _ := windows.UTF16PtrFromString(helper)
	params, _ := windows.UTF16PtrFromString(fmt.Sprintf(`"%s" "%s"`, reqFile, respFile))

	info := shellExecuteInfo{
		fMask:        seeMaskNoCloseProcess,
		lpVerb:       verb,
		lpFile:       file,
		lpParameters: params,
		nShow:        swHide,
	}
	info.cbSize = uint32(unsafe.Sizeof(info))

	r, _, err := procShellExecuteEx.Call(uintptr(unsafe.Pointer(&info)))
	if r == 0 {
		return fmt.Errorf("elevation failed (user declined?): %v", err)
	}
	if info.hProcess == 0 {
		return fmt.Errorf("elevation did not start a process")
	}
	defer windows.CloseHandle(info.hProcess)

	// Wait up to 60s for the helper to finish.
	ev, _ := windows.WaitForSingleObject(info.hProcess, uint32(60*time.Second/time.Millisecond))
	if ev == uint32(windows.WAIT_TIMEOUT) {
		return fmt.Errorf("elevated helper timed out")
	}
	// A non-zero exit is surfaced via the response file the helper writes.
	return nil
}
