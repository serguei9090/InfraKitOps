package qrdecode

import (
	"bytes"
	"image"
	"image/color"
	"image/png"
	"testing"

	"github.com/makiuchi-d/gozxing"
	"github.com/makiuchi-d/gozxing/qrcode"
)

func makeQRPNG(t *testing.T, text string) []byte {
	t.Helper()
	bm, err := qrcode.NewQRCodeWriter().Encode(text, gozxing.BarcodeFormat_QR_CODE, 240, 240, nil)
	if err != nil {
		t.Fatalf("encode: %v", err)
	}
	w, h := bm.GetWidth(), bm.GetHeight()
	img := image.NewGray(image.Rect(0, 0, w, h))
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			if bm.Get(x, y) {
				img.SetGray(x, y, color.Gray{Y: 0})
			} else {
				img.SetGray(x, y, color.Gray{Y: 255})
			}
		}
	}
	var buf bytes.Buffer
	if err := png.Encode(&buf, img); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

func TestDecodeRoundTrip(t *testing.T) {
	const want = "https://infrakit.studio/x?y=1"
	res, err := Decode(makeQRPNG(t, want))
	if err != nil {
		t.Fatal(err)
	}
	if res.Text != want {
		t.Errorf("text = %q, want %q", res.Text, want)
	}
	if res.Format != "QR_CODE" {
		t.Errorf("format = %q, want QR_CODE", res.Format)
	}
}

func TestDecodeNoCode(t *testing.T) {
	img := image.NewGray(image.Rect(0, 0, 64, 64))
	var buf bytes.Buffer
	_ = png.Encode(&buf, img)
	if _, err := Decode(buf.Bytes()); err == nil {
		t.Error("expected an error for a blank image")
	}
}

func TestDecodeBadInput(t *testing.T) {
	if _, err := Decode(nil); err == nil {
		t.Error("expected an error for empty input")
	}
	if _, err := Decode([]byte("not an image")); err == nil {
		t.Error("expected an error for non-image input")
	}
}
