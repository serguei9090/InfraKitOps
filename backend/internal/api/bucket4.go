package api

import (
	"encoding/json"
	"net/http"
	"strings"

	"github.com/infrakit/backend/internal/apierr"
	"github.com/infrakit/backend/internal/tools/qrdecode"
	"github.com/infrakit/backend/internal/tools/x509fetch"
)

// QRDecode: POST /qr/decode (multipart, field "file") — gozxing QR decode,
// more tolerant than the client-side jsqr.
func QRDecode(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, 32<<20)
	if err := r.ParseMultipartForm(16 << 20); err != nil {
		apierr.Write(w, apierr.Validation("expected a multipart image upload"))
		return
	}
	f, _, err := r.FormFile("file")
	if err != nil {
		apierr.Write(w, apierr.Validation("no \"file\" field in the upload"))
		return
	}
	defer f.Close()
	data := make([]byte, 0, 64<<10)
	buf := make([]byte, 32<<10)
	for {
		n, rerr := f.Read(buf)
		data = append(data, buf[:n]...)
		if rerr != nil {
			break
		}
	}
	res, derr := qrdecode.Decode(data)
	if derr != nil {
		apierr.Write(w, apierr.Validation(derr.Error()))
		return
	}
	WriteJSON(w, http.StatusOK, res)
}

type x509FetchRequest struct {
	Host string `json:"host"`
}

// X509Fetch: POST /x509/fetch { host } — connect to host:443 and return the
// certificate chain (PEM) plus whether it verifies against the system roots.
func X509Fetch(w http.ResponseWriter, r *http.Request) {
	var req x509FetchRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		apierr.Write(w, apierr.Validation(err.Error()))
		return
	}
	if strings.TrimSpace(req.Host) == "" {
		apierr.Write(w, apierr.Validation("a hostname is required"))
		return
	}
	res, err := x509fetch.Fetch(r.Context(), req.Host)
	if err != nil {
		if ne := apierr.ClassifyNet(err); ne != nil {
			apierr.Write(w, ne)
		} else {
			apierr.Write(w, apierr.Unreachable(err.Error()))
		}
		return
	}
	WriteJSON(w, http.StatusOK, res)
}
