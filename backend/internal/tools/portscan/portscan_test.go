package portscan

import (
	"context"
	"net"
	"reflect"
	"testing"
	"time"
)

func TestParsePorts(t *testing.T) {
	got, err := ParsePorts("22, 80,443, 8000-8003, 80")
	if err != nil {
		t.Fatal(err)
	}
	want := []int{22, 80, 443, 8000, 8001, 8002, 8003}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %v want %v", got, want)
	}
}

func TestParsePortsRejectsGarbage(t *testing.T) {
	for _, bad := range []string{"abc", "0", "70000", "100-50", "1-"} {
		if _, err := ParsePorts(bad); err == nil {
			t.Errorf("ParsePorts(%q) accepted invalid input", bad)
		}
	}
}

func TestScanFindsAnOpenPort(t *testing.T) {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer ln.Close()
	openPort := ln.Addr().(*net.TCPAddr).Port

	var opens []int
	res := Scan(context.Background(), Options{
		Hosts:   []string{"127.0.0.1"},
		Ports:   []int{openPort, openPort + 1},
		Timeout: 500 * time.Millisecond,
	}, func(event string, payload any) {
		if event == "open" {
			opens = append(opens, payload.(PortResult).Port)
		}
	})

	if len(res.Open) != 1 || res.Open[0].Port != openPort {
		t.Fatalf("expected exactly the listening port open, got %+v", res.Open)
	}
	if len(opens) != 1 || opens[0] != openPort {
		t.Fatalf("open event not emitted correctly: %v", opens)
	}
}

func TestScanRespectsContextCancel(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	res := Scan(ctx, Options{Hosts: []string{"127.0.0.1"}, Ports: []int{1, 2, 3}}, func(string, any) {})
	if len(res.Open) != 0 {
		t.Fatalf("cancelled scan should produce nothing, got %+v", res.Open)
	}
}
