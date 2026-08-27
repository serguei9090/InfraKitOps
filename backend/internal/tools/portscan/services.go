package portscan

// commonServices maps well-known TCP ports to their IANA service name. A
// compact built-in table covering the ports people actually scan; the full
// IANA CSV can be embedded later if needed.
var commonServices = map[int]string{
	20: "ftp-data", 21: "ftp", 22: "ssh", 23: "telnet", 25: "smtp", 37: "time",
	43: "whois", 53: "domain", 67: "dhcps", 68: "dhcpc", 69: "tftp", 79: "finger",
	80: "http", 88: "kerberos", 110: "pop3", 111: "rpcbind", 113: "ident",
	119: "nntp", 123: "ntp", 135: "msrpc", 137: "netbios-ns", 138: "netbios-dgm",
	139: "netbios-ssn", 143: "imap", 161: "snmp", 162: "snmptrap", 179: "bgp",
	389: "ldap", 443: "https", 445: "microsoft-ds", 465: "smtps", 500: "isakmp",
	514: "syslog", 515: "printer", 520: "rip", 587: "submission", 623: "ipmi",
	636: "ldaps", 873: "rsync", 902: "vmware", 989: "ftps-data", 990: "ftps",
	993: "imaps", 995: "pop3s", 1080: "socks", 1194: "openvpn", 1433: "ms-sql-s",
	1521: "oracle", 1723: "pptp", 1883: "mqtt", 2049: "nfs", 2181: "zookeeper",
	2375: "docker", 2376: "docker-s", 2483: "oracle-ssl", 3000: "ppp",
	3128: "squid-http", 3306: "mysql", 3389: "ms-wbt-server", 4444: "krb524",
	4567: "tram", 5000: "upnp", 5060: "sip", 5432: "postgresql", 5601: "kibana",
	5672: "amqp", 5900: "vnc", 5985: "wsman", 5986: "wsmans", 6379: "redis",
	6443: "kube-apiserver", 7001: "afs3-callback", 8000: "http-alt", 8008: "http",
	8080: "http-proxy", 8081: "http-alt", 8086: "influxdb", 8443: "https-alt",
	8883: "mqtt-ssl", 9000: "cslistener", 9042: "cassandra", 9090: "prometheus",
	9092: "kafka", 9100: "jetdirect", 9200: "elasticsearch", 9300: "elastic-cluster",
	10000: "webmin", 11211: "memcached", 15672: "rabbitmq-mgmt", 25565: "minecraft",
	27017: "mongodb", 32400: "plex", 50000: "db2",
}

// ServiceName returns the well-known name for a TCP port, or "".
func ServiceName(port int) string {
	return commonServices[port]
}

// Profiles are named port sets the UI offers as one-click presets.
var Profiles = map[string][]int{
	"Common":        {21, 22, 23, 25, 53, 80, 110, 111, 135, 139, 143, 443, 445, 993, 995, 3306, 3389, 5432, 8080},
	"Web":           {80, 443, 8000, 8008, 8080, 8081, 8443, 8888},
	"Databases":     {1433, 1521, 3306, 5432, 6379, 9042, 11211, 27017},
	"Remote access": {22, 23, 3389, 5900, 5985, 5986},
	"Mail":          {25, 110, 143, 465, 587, 993, 995},
	"DNS / DHCP":    {53, 67, 68, 853},
	"SMB / AD":      {88, 135, 139, 389, 445, 636, 3268, 3269},
	"Windows":       {135, 139, 445, 3389, 5985},
}
