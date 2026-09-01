package api

import (
	"fmt"
	"io"
	"net/http"

	"github.com/infrakit/backend/internal/apierr"
	"github.com/infrakit/backend/internal/tools/pdftool"
)

// maxPDFUpload caps a single uploaded PDF. Large enough for real documents,
// small enough to keep a rogue request from exhausting memory.
const maxPDFUpload = 128 << 20 // 128 MiB

func readUploadedPDF(w http.ResponseWriter, r *http.Request) ([]byte, bool) {
	r.Body = http.MaxBytesReader(w, r.Body, maxPDFUpload+(1<<20))
	if err := r.ParseMultipartForm(16 << 20); err != nil {
		apierr.Write(w, apierr.Validation("expected a multipart form upload: "+err.Error()))
		return nil, false
	}
	f, hdr, err := r.FormFile("file")
	if err != nil {
		apierr.Write(w, apierr.Validation("no \"file\" field in the upload"))
		return nil, false
	}
	defer f.Close()
	if hdr.Size > maxPDFUpload {
		e := apierr.Validation("the PDF is larger than 128 MiB")
		e.Status = http.StatusRequestEntityTooLarge
		apierr.Write(w, e)
		return nil, false
	}
	data, err := io.ReadAll(f)
	if err != nil {
		apierr.Write(w, apierr.Validation(err.Error()))
		return nil, false
	}
	return data, true
}

// PDFInspect: POST /pdf/inspect (multipart, field "file") — pdfcpu metadata +
// validation. Richer than the client-side pdf-lib inspector.
func PDFInspect(w http.ResponseWriter, r *http.Request) {
	data, ok := readUploadedPDF(w, r)
	if !ok {
		return
	}
	info, err := pdftool.Inspect(data)
	if err != nil {
		apierr.Write(w, apierr.Validation(err.Error()))
		return
	}
	WriteJSON(w, http.StatusOK, map[string]any{"info": info})
}

// PDFTransform: POST /pdf/transform (multipart) — op=optimize|encrypt|decrypt.
// On success returns the resulting PDF bytes (application/pdf); on failure a
// JSON error.
func PDFTransform(w http.ResponseWriter, r *http.Request) {
	data, ok := readUploadedPDF(w, r)
	if !ok {
		return
	}
	op := r.FormValue("op")
	var (
		out []byte
		err error
	)
	switch op {
	case "optimize":
		out, err = pdftool.Optimize(data)
	case "encrypt":
		out, err = pdftool.Encrypt(data, r.FormValue("userPw"), r.FormValue("ownerPw"))
	case "decrypt":
		out, err = pdftool.Decrypt(data, r.FormValue("password"))
	default:
		apierr.Write(w, apierr.Validation(fmt.Sprintf("unknown op %q (want optimize, encrypt or decrypt)", op)))
		return
	}
	if err != nil {
		apierr.Write(w, apierr.Validation(err.Error()))
		return
	}
	w.Header().Set("Content-Type", "application/pdf")
	w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="%s.pdf"`, op))
	w.Header().Set("X-Pdf-Bytes-In", fmt.Sprintf("%d", len(data)))
	w.Header().Set("X-Pdf-Bytes-Out", fmt.Sprintf("%d", len(out)))
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(out)
}
