package pdftool

import (
	"bytes"
	"os"
	"path/filepath"
	"testing"

	"github.com/pdfcpu/pdfcpu/pkg/api"
	"github.com/pdfcpu/pdfcpu/pkg/pdfcpu"
	"github.com/pdfcpu/pdfcpu/pkg/pdfcpu/model"
	"github.com/pdfcpu/pdfcpu/pkg/pdfcpu/types"
)

// demoPDF builds a small valid single-page PDF with pdfcpu itself.
func demoPDF(t *testing.T) []byte {
	t.Helper()
	p := model.Page{MediaBox: types.RectForFormat("A4"), Fm: model.FontMap{}, Buf: new(bytes.Buffer)}
	pdfcpu.CreateTestPageContent(p)
	xt, err := pdfcpu.CreateDemoXRef()
	if err != nil {
		t.Fatalf("CreateDemoXRef: %v", err)
	}
	rootDict, err := xt.Catalog()
	if err != nil {
		t.Fatalf("Catalog: %v", err)
	}
	if err := pdfcpu.AddPageTreeWithSamplePage(xt, rootDict, p); err != nil {
		t.Fatalf("AddPageTreeWithSamplePage: %v", err)
	}
	out := filepath.Join(t.TempDir(), "demo.pdf")
	if err := api.CreatePDFFile(xt, out, nil); err != nil {
		t.Fatalf("CreatePDFFile: %v", err)
	}
	data, err := os.ReadFile(out)
	if err != nil {
		t.Fatal(err)
	}
	return data
}

func TestInspect(t *testing.T) {
	info, err := Inspect(demoPDF(t))
	if err != nil {
		t.Fatal(err)
	}
	if info.PageCount < 1 {
		t.Errorf("pageCount = %d, want >= 1", info.PageCount)
	}
	if info.Encrypted {
		t.Error("demo PDF should not be encrypted")
	}
	if !info.Valid {
		t.Errorf("demo PDF should validate; got %q", info.ValidationMessage)
	}
	if info.Version == "" {
		t.Error("version should be set")
	}
}

func TestInspectRejectsGarbage(t *testing.T) {
	if _, err := Inspect([]byte("not a pdf")); err == nil {
		t.Error("expected an error for non-PDF input")
	}
	if _, err := Inspect(nil); err == nil {
		t.Error("expected an error for empty input")
	}
}

func TestOptimize(t *testing.T) {
	out, err := Optimize(demoPDF(t))
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.HasPrefix(out, []byte("%PDF-")) {
		t.Error("optimize output is not a PDF")
	}
	info, err := Inspect(out)
	if err != nil || info.PageCount < 1 {
		t.Errorf("optimized PDF no longer inspects: %v / %+v", err, info)
	}
}

func TestEncryptDecryptRoundTrip(t *testing.T) {
	src := demoPDF(t)

	// Owner-only encryption: the file still opens without a password but its
	// permissions are locked and Encrypted flips true.
	enc, err := Encrypt(src, "", "owner-me")
	if err != nil {
		t.Fatalf("encrypt: %v", err)
	}
	info, err := Inspect(enc)
	if err != nil {
		t.Fatalf("inspect encrypted: %v", err)
	}
	if !info.Encrypted {
		t.Error("encrypted PDF reports Encrypted=false")
	}

	if _, err := Decrypt(enc, "wrong"); err == nil {
		t.Error("decrypt with the wrong password should fail")
	}

	dec, err := Decrypt(enc, "owner-me")
	if err != nil {
		t.Fatalf("decrypt: %v", err)
	}
	info2, err := Inspect(dec)
	if err != nil {
		t.Fatalf("inspect decrypted: %v", err)
	}
	if info2.Encrypted {
		t.Error("decrypted PDF still reports Encrypted=true")
	}
}

func TestEncryptRequiresPassword(t *testing.T) {
	if _, err := Encrypt(demoPDF(t), "", ""); err == nil {
		t.Error("expected an error when no password is given")
	}
}
