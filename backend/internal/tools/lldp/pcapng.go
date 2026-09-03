package lldp

import (
	"encoding/binary"
	"fmt"
	"io"
)

// pcapng block types we care about.
const (
	blkSectionHeader      = 0x0A0D0D0A
	blkInterfaceDesc      = 0x00000001
	blkEnhancedPacket     = 0x00000006
	blkSimplePacket       = 0x00000003
	sectionByteOrderMagic = 0x1A2B3C4D
)

// ReadPcapngFrames pulls raw link-layer frames out of a pcapng stream — enough
// of the format for pktmon / dumpcap output (SHB, IDB, EPB, SPB). Interface
// names, when present in an IDB option, are attached to each frame.
func ReadPcapngFrames(r io.Reader, onFrame func(iface string, data []byte)) error {
	var bo binary.ByteOrder = binary.LittleEndian
	ifaceNames := []string{}

	for {
		var head [8]byte
		if _, err := io.ReadFull(r, head[:]); err != nil {
			if err == io.EOF || err == io.ErrUnexpectedEOF {
				return nil
			}
			return err
		}
		blkType := binary.LittleEndian.Uint32(head[0:4]) // SHB is byte-order agnostic for its type
		// total length is in the section's byte order once known; for the SHB
		// both encodings of the magic disambiguate.
		totalLen := bo.Uint32(head[4:8])
		if blkType == blkSectionHeader {
			totalLen = binary.LittleEndian.Uint32(head[4:8])
		}
		if totalLen < 12 || totalLen > 64<<20 {
			return fmt.Errorf("pcapng: implausible block length %d", totalLen)
		}
		body := make([]byte, totalLen-12)
		if _, err := io.ReadFull(r, body); err != nil {
			return err
		}
		var trailer [4]byte
		if _, err := io.ReadFull(r, trailer[:]); err != nil {
			return err
		}

		switch blkType {
		case blkSectionHeader:
			if len(body) >= 4 && binary.BigEndian.Uint32(body[0:4]) == sectionByteOrderMagic {
				bo = binary.BigEndian
			} else {
				bo = binary.LittleEndian
			}
			ifaceNames = ifaceNames[:0]

		case blkInterfaceDesc:
			name := ""
			if len(body) >= 8 {
				name = idbName(body[8:], bo) // options start after linktype(2)+reserved(2)+snaplen(4)
			}
			ifaceNames = append(ifaceNames, name)

		case blkEnhancedPacket:
			if len(body) < 20 {
				continue
			}
			ifID := int(bo.Uint32(body[0:4]))
			capLen := int(bo.Uint32(body[12:16]))
			if 20+capLen > len(body) || capLen <= 0 {
				continue
			}
			onFrame(ifaceName(ifaceNames, ifID), body[20:20+capLen])

		case blkSimplePacket:
			if len(body) < 4 {
				continue
			}
			origLen := int(bo.Uint32(body[0:4]))
			if 4+origLen > len(body) || origLen <= 0 {
				continue
			}
			onFrame("", body[4:4+origLen])
		}
	}
}

func ifaceName(names []string, id int) string {
	if id >= 0 && id < len(names) {
		return names[id]
	}
	return ""
}

// idbName scans IDB options for if_name (code 2).
func idbName(opts []byte, bo binary.ByteOrder) string {
	i := 0
	for i+4 <= len(opts) {
		code := bo.Uint16(opts[i : i+2])
		ln := int(bo.Uint16(opts[i+2 : i+4]))
		i += 4
		if i+ln > len(opts) {
			break
		}
		if code == 0 { // opt_endofopt
			break
		}
		if code == 2 { // if_name
			return string(opts[i : i+ln])
		}
		i += ln + (4-ln%4)%4 // 32-bit padded
	}
	return ""
}
