// Package qrdecode decodes a QR code from an image with gozxing (pure Go,
// MIT). It is the backend "power mode" for the client-side QR Code Reader,
// which uses jsqr — gozxing is more tolerant of rotation, low contrast and
// noise. See TOOL_STRATEGY_REVIEW.md bucket 4.
package qrdecode

import (
	"bytes"
	"fmt"
	"image"
	_ "image/gif"
	_ "image/jpeg"
	_ "image/png"

	"github.com/makiuchi-d/gozxing"
	"github.com/makiuchi-d/gozxing/qrcode"
	_ "golang.org/x/image/bmp"
	_ "golang.org/x/image/tiff"
	_ "golang.org/x/image/webp"
)

// Result is one decoded QR code.
type Result struct {
	Text   string `json:"text"`
	Format string `json:"format"`
}

// Decode finds and reads a QR code in the image bytes.
func Decode(data []byte) (Result, error) {
	if len(data) == 0 {
		return Result{}, fmt.Errorf("the image is empty")
	}
	img, _, err := image.Decode(bytes.NewReader(data))
	if err != nil {
		return Result{}, fmt.Errorf("could not decode the image: %w", err)
	}
	bmp, err := gozxing.NewBinaryBitmapFromImage(img)
	if err != nil {
		return Result{}, fmt.Errorf("could not prepare the image: %w", err)
	}

	reader := qrcode.NewQRCodeReader()
	hints := map[gozxing.DecodeHintType]interface{}{
		gozxing.DecodeHintType_TRY_HARDER: true,
	}
	res, err := reader.Decode(bmp, hints)
	if err != nil {
		return Result{}, fmt.Errorf("no QR code found in the image")
	}
	return Result{Text: res.GetText(), Format: res.GetBarcodeFormat().String()}, nil
}
