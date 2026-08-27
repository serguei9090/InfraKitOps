// Package pdftool is the backend "power mode" for the client-side PDF tools.
// The browser build uses pdf-lib for split/merge and basic metadata; this
// package uses pdfcpu (pure Go, Apache-2.0) to add operations pdf-lib cannot
// do: structural validation, linearization/optimize, and password
// encrypt/decrypt. See TOOL_STRATEGY_REVIEW.md bucket 1.
package pdftool

import (
	"bytes"
	"fmt"
	"strings"

	"github.com/pdfcpu/pdfcpu/pkg/api"
	"github.com/pdfcpu/pdfcpu/pkg/pdfcpu/model"
)

// Info is the trimmed, JSON-friendly subset of pdfcpu's PDFInfo the UI shows.
type Info struct {
	Version          string   `json:"version"`
	PageCount        int      `json:"pageCount"`
	PageSizes        []string `json:"pageSizes"`
	Title            string   `json:"title,omitempty"`
	Author           string   `json:"author,omitempty"`
	Subject          string   `json:"subject,omitempty"`
	Creator          string   `json:"creator,omitempty"`
	Producer         string   `json:"producer,omitempty"`
	CreationDate     string   `json:"creationDate,omitempty"`
	ModificationDate string   `json:"modificationDate,omitempty"`
	Keywords         []string `json:"keywords,omitempty"`

	Encrypted        bool `json:"encrypted"`
	Permissions      int  `json:"permissions"`
	Tagged           bool `json:"tagged"`
	Linearized       bool `json:"linearized"`
	Form             bool `json:"form"`
	Signatures       bool `json:"signatures"`
	Watermarked      bool `json:"watermarked"`
	Bookmarks        bool `json:"bookmarks"`
	UsingXRefStreams bool `json:"usingXRefStreams"`

	// Valid is true when pdfcpu's validator accepted the file with no errors;
	// ValidationMessage carries the reason when it did not (the file still
	// parsed enough to report the fields above).
	Valid             bool   `json:"valid"`
	ValidationMessage string `json:"validationMessage,omitempty"`
}

func relaxedConf() *model.Configuration {
	c := model.NewDefaultConfiguration()
	c.ValidationMode = model.ValidationRelaxed
	return c
}

// Inspect returns metadata, encryption, and validation status for a PDF.
func Inspect(data []byte) (Info, error) {
	if len(data) == 0 {
		return Info{}, fmt.Errorf("the PDF is empty")
	}
	pi, err := api.PDFInfo(bytes.NewReader(data), "", nil, false, relaxedConf())
	if err != nil {
		return Info{}, fmt.Errorf("could not read the PDF: %w", err)
	}

	sizes := make([]string, 0, len(pi.Dimensions))
	for _, d := range pi.Dimensions {
		sizes = append(sizes, fmt.Sprintf("%.0f x %.0f pt", d.Width, d.Height))
	}

	info := Info{
		Version:          pi.Version,
		PageCount:        pi.PageCount,
		PageSizes:        sizes,
		Title:            pi.Title,
		Author:           pi.Author,
		Subject:          pi.Subject,
		Creator:          pi.Creator,
		Producer:         pi.Producer,
		CreationDate:     pi.CreationDate,
		ModificationDate: pi.ModificationDate,
		Keywords:         pi.Keywords,
		Encrypted:        pi.Encrypted,
		Permissions:      pi.Permissions,
		Tagged:           pi.Tagged,
		Linearized:       pi.Linearized,
		Form:             pi.Form,
		Signatures:       pi.Signatures,
		Watermarked:      pi.Watermarked,
		Bookmarks:        pi.Outlines,
		UsingXRefStreams: pi.UsingXRefStreams,
	}

	if err := api.Validate(bytes.NewReader(data), relaxedConf()); err != nil {
		info.Valid = false
		info.ValidationMessage = strings.TrimSpace(err.Error())
	} else {
		info.Valid = true
	}
	return info, nil
}

// Optimize rewrites the PDF with pdfcpu's optimizer (dedupes objects, uses
// object/xref streams), usually shrinking it.
func Optimize(data []byte) ([]byte, error) {
	if len(data) == 0 {
		return nil, fmt.Errorf("the PDF is empty")
	}
	var out bytes.Buffer
	if err := api.Optimize(bytes.NewReader(data), &out, relaxedConf()); err != nil {
		return nil, fmt.Errorf("optimize failed: %w", err)
	}
	return out.Bytes(), nil
}

// Encrypt applies AES-256 encryption. userPW is required to open the file;
// ownerPW (falls back to userPW) is required to change permissions.
func Encrypt(data []byte, userPW, ownerPW string) ([]byte, error) {
	if len(data) == 0 {
		return nil, fmt.Errorf("the PDF is empty")
	}
	if userPW == "" && ownerPW == "" {
		return nil, fmt.Errorf("a password is required to encrypt")
	}
	if ownerPW == "" {
		ownerPW = userPW
	}
	conf := relaxedConf()
	conf.UserPW = userPW
	conf.OwnerPW = ownerPW
	conf.EncryptUsingAES = true
	conf.EncryptKeyLength = 256
	conf.Permissions = model.PermissionsPrint

	var out bytes.Buffer
	if err := api.Encrypt(bytes.NewReader(data), &out, conf); err != nil {
		return nil, fmt.Errorf("encrypt failed: %w", err)
	}
	return out.Bytes(), nil
}

// Decrypt removes encryption given the current password.
func Decrypt(data []byte, password string) ([]byte, error) {
	if len(data) == 0 {
		return nil, fmt.Errorf("the PDF is empty")
	}
	conf := relaxedConf()
	conf.UserPW = password
	conf.OwnerPW = password

	var out bytes.Buffer
	if err := api.Decrypt(bytes.NewReader(data), &out, conf); err != nil {
		return nil, fmt.Errorf("decrypt failed (wrong password?): %w", err)
	}
	return out.Bytes(), nil
}
