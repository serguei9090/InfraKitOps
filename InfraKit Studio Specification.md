# **InfraKit Studio — Architecture Specification & Master Taxonomy**

> **Note (2026-08-25):** the implementation has moved from Flutter (archived to
> `archive/flutter-app/`) to React + Tauri v2 (`app/`) — see `CLAUDE.md` and
> `MIGRATION_PLAN.md` for the stack decision and migration history. The module
> taxonomy, wireframes, and hexagonal architecture below are stack-agnostic and
> still describe the current app; "Flutter Web/Desktop" in the adapters diagram
> below now reads as "React Web (Vite) / React in a Tauri webview (desktop)".

## **1\. System Architecture: Ports & Adapters (Hexagonal Architecture)**

InfraKit Studio uses a strict Hexagonal Architecture to ensure that core calculation logic, schema parsers, converters, and file generators remain 100% decoupled from the UI, persistence layer, or external daemons.

                  ┌─────────────────────────────────────────┐  
                  │              ADAPTERS (UI)              │  
                  │  \- Flutter Web (WASM / Canvas)          │  
                  │  \- Flutter Desktop (Linux/Win/macOS)    │  
                  └────────────────────┬────────────────────┘  
                                       │  
                                 PRIMARY PORTS  
                       (Inbound UI / File Events)  
                                       │  
                                       ▼  
┌────────────────────────────────────────────────────────────────────────┐  
│                          CORE (THE HEXAGON)                            │  
│  Pure Dart Domain Logic (Zero UI / Zero IO Dependencies)               │  
│                                                                        │  
│  \- Tuning Domain: Ceph Math, Kernel BDP, DB Memory Rules               │  
│  \- Utility Domain: CIDR Math, Crypto/Keys, Converters, Formatters      │  
│  \- Office Media Engine: PDF Manipulation, Image Compression, EXIF      │  
│  \- FormFlow Engine: Structural Auto-Detection, AST Parser & Loops      │  
│  \- Template Engine: Mustache / String Interpolation                    │  
└──────────────────────────────────────┬─────────────────────────────────┘  
                                       │  
                                SECONDARY PORTS  
                       (Outbound Persistence & I/O)  
                                       │  
                                       ▼  
                  ┌─────────────────────────────────────────┐  
                  │          ADAPTERS (PERSISTENCE)         │  
                  │  \- Browser LocalStorage / IndexedDB     │  
                  │  \- Native File System (Desktop IO)      │  
                  │  \- Embedded Asset Bundles (Built-in)    │  
                  └────────────────────┴────────────────────┘

### **Architectural Layer Responsibilities**

1. **The Core (Domain Layer)**  
   * Holds pure calculation routines, mathematical formulas, XML/YAML AST parsers, image/PDF manipulators, and template renderers.  
   * **Rule:** Contains zero imports from flutter/material.dart or external I/O libraries. Fully testable via standard Dart unit tests in milliseconds.  
2. **Ports (Interface Layer)**  
   * **Inbound Ports (IToolUseCase, IFormFlowUseCase):** Standardized interfaces through which the UI triggers calculation, schema loading, or form generation.  
   * **Outbound Ports (ISchemaRepository, IStoragePort):** Interfaces defining how templates, saved form schemas, and user settings are read/written.  
3. **Adapters (Infrastructure Layer)**  
   * **UI Adapter:** Responsive Flutter widgets (DevToys-style grid, NavigationRail, FormBuilder, Sliders, xterm UI). Can be replaced or upgraded without touching domain logic.  
   * **Storage Adapter:** Browser LocalStorage/IndexedDB for Web, native file system (dart:io) for Desktop.

## **2\. Responsive UI Architecture & Wireframes (DevToys & IT-Tools Hybrid)**

The UI is modeled after the DevToys dashboard and IT-Tools layout:

* **Top App Bar:** Global search bar (Cmd/Ctrl \+ K fuzzy search across all tools), quick theme switcher (Dark/Light), and favorite tools access.  
* **Left Sidebar (Navigation Rail):** Grouped expandable categories with icons, collapsible for compact screens.  
* **Main Dashboard (Home View):** Card-based grid showcasing all available tools categorized with icons, descriptions, and quick-launch buttons.  
* **Tool Detail View:** Split-panel layout with inputs on the left/top and real-time generated outputs/code blocks on the right/bottom with copy-to-clipboard functionality.

### **UI Layout Wireframe 1: Desktop Main Dashboard (Home Grid View)**

┌────────────────────────────────────────────────────────────────────────────────────────────────────────┐  
│ \[≡\] InfraKit Studio  │  \[ 🔍 Search tools, formulas, cheatsheets... (Cmd+K) \]      │  \[⭐ 4\] \[🌙\] \[⚙️\]  │  
├──────────────────────┴─────────────────────────────────────────────────────────────────────────────────┤  
│                                                                                                        │  
│  ┌───────────────────────┐   Welcome to InfraKit Studio                                                │  
│  │ 🏠 All Tools          │   Declarative SRE, SysAdmin & Developer Workbench                           │  
│  ├───────────────────────┤                                                                             │  
│  │ ⚡ 1\. Tuning & Perf   │   1\. TUNING & PERFORMANCE                                                   │  
│  │    ├ Linux Kernel     │   ┌──────────────────────────────┐  ┌──────────────────────────────┐          │  
│  │    ├ Ceph Storage     │   │ 🐧 Linux Kernel Sysctl       │  │ 🦭 Ceph PG Calculator        │          │  
│  │    ├ Database RAM     │   │ Network buffers, BBR, sysctl │  │ Power-of-2 PG rounding math │          │  
│  │    └ Monitoring       │   │ \[ Launch Tool \]              │  │ \[ Launch Tool \]              │          │  
│  │                       │   └──────────────────────────────┘  └──────────────────────────────┘          │  
│  │ 🛠️ 2\. Dev Utilities   │                                                                             │  
│  │    ├ Security & Keys  │   2\. DAILY DEVELOPER & UTILITIES                                            │  
│  │    ├ Converters       │   ┌──────────────────────────────┐  ┌──────────────────────────────┐          │  
│  │    ├ Formatters       │   │ 🔐 SSH Key Pair Generator    │  │ 🌐 IPv4 Subnet Calculator    │          │  
│  │    └ Network Tools    │   │ Ed25519 / RSA WebCrypto      │  │ Usable IPs, CIDR mask math   │          │  
│  │                       │   │ \[ Launch Tool \]              │  │ \[ Launch Tool \]              │          │  
│  │ 📄 3\. Office & Media  │   └──────────────────────────────┘  └──────────────────────────────┘          │  
│  │    ├ PDF Suite        │                                                                             │  
│  │    └ Image / Visual   │   3\. FORMFLOW DYNAMIC BUILDER                                               │  
│  │                       │   ┌──────────────────────────────┐  ┌──────────────────────────────┐          │  
│  │ 🧩 4\. FormFlow Engine │   │ 📐 XML/YAML Form Designer    │  │ 📋 Custom Saved Templates    │          │  
│  │                       │   │ Auto-detect schema & loops   │  │ User library in LocalStorage │          │  
│  │ 📚 5\. Cheatsheet Hub  │   │ \[ Launch Builder \]           │  │ \[ Open Library \]             │          │  
│  └───────────────────────┘   └──────────────────────────────┘  └──────────────────────────────┘          │  
└────────────────────────────────────────────────────────────────────────────────────────────────────────┘

### **UI Layout Wireframe 2: Tool Detail Split Panel View (Inputs ⟷ Output)**

┌────────────────────────────────────────────────────────────────────────────────────────────────────────┐  
│ \[≡\] InfraKit Studio  /  Tuning & Performance  /  Linux Kernel Sysctl          \[⭐ Favorite\] \[📋 Copy\]  │  
├───────────────────────────────────────────────────────┬────────────────────────────────────────────────┤  
│ INPUT PARAMETERS & CONTROLS                           │ GENERATED OUTPUT & LIVE PREVIEW                │  
├───────────────────────────────────────────────────────┼────────────────────────────────────────────────┤  
│ Network Interface Speed Profile                       │ \# /etc/sysctl.d/99-network-performance.conf    │  
│ (•) 10 Gbps Network Interface                         │ \# Profile: 10 Gbps | BBR: Enabled              │  
│ ( ) 40 / 100 Gbps High-Throughput Node                │                                                │  
│                                                       │ net.core.somaxconn \= 8192                      │  
│ Enable BBR Congestion Control                         │ net.ipv4.tcp\_max\_syn\_backlog \= 8192            │  
│ \[ \[ON\]  \]  (Toggles fq \+ tcp\_bbr modules)             │ net.ipv4.tcp\_tw\_reuse \= 1                      │  
│                                                       │                                                │  
│ Enable TIME\_WAIT Socket Reuse                         │ net.core.default\_qdisc \= fq                    │  
│ \[ \[ON\]  \]                                             │ net.ipv4.tcp\_congestion\_control \= bbr          │  
│                                                       │                                                │  
│ TCP SYN Backlog Queue Size                            │ net.core.rmem\_max \= 67108864                   │  
│ \[====================o───────────\]  8192              │ net.core.wmem\_max \= 67108864                   │  
│ (Min: 1024, Max: 65536\)                               │ net.ipv4.tcp\_rmem \= 4096 87380 33554432        │  
│                                                       │ net.ipv4.tcp\_wmem \= 4096 65536 33554432        │  
│ System Memory Allocated for Sockets (GB)              │                                                │  
│ \[=========o──────────────────────\]  16 GB             │ ┌────────────────────────────────────────────┐ │  
│                                                       │ │ \[ Copy to Clipboard \]  \[ Save Configuration\]│ │  
│                                                       │ └────────────────────────────────────────────┘ │  
└───────────────────────────────────────────────────────┴────────────────────────────────────────────────┘

### **UI Layout Wireframe 3: FormFlow Dynamic Form Builder View**

┌────────────────────────────────────────────────────────────────────────────────────────────────────────┐  
│ \[≡\] InfraKit Studio  /  FormFlow Builder  /  XML Template Parser               \[ Upload File \] \[ Save \]│  
├───────────────────────────────────────────────────────┬────────────────────────────────────────────────┤  
│ SCHEMA DESIGNER & FIELD MAPPER                        │ LIVE INTERACTIVE FORM & OUTPUT                 │  
├───────────────────────────────────────────────────────┼────────────────────────────────────────────────┤  
│ 📁 Uploaded: application\_config.xml                   │ Interactive Form Preview                       │  
│                                                       │                                                │  
│ DETECTED STRUCTURAL NODES:                            │ Server Name:                                   │  
│ ├─ \<app\_name\>        \[ Field Type: Text Input      ▼\] │ \[ prod-app-01                         \]        │  
│ ├─ \<enable\_ssl\>      \[ Field Type: Switch Toggle   ▼\] │                                                │  
│ └─ \<server\_cluster\>  \[ Mark as Dynamic Array Loop  ☑\] │ Enable SSL Encryption:                         │  
│     ├─ \<hostname\>    \[ Field Type: Text Input      ▼\] │ \[ \[ON\]  \]                                      │  
│     └─ \<port\>        \[ Field Type: Number Input    ▼\] │                                                │  
│                                                       │ Server Cluster Nodes:                          │  
│                                                       │ ┌─ Node \#1 ──────────────────────────────────┐ │  
│                                                       │ │ Hostname: \[ node-01.internal             \] │ │  
│                                                       │ │ Port:     \[ 8080                         \] │ │  
│                                                       │ └────────────────────────────────────────────┘ │  
│                                                       │ \[ \+ Add Cluster Node \]  \<-- (Dynamic Array)    │  
│                                                       │                                                │  
│                                                       │ LIVE GENERATED XML OUTPUT:                     │  
│                                                       │ \<config\>                                       │  
│                                                       │   \<app\_name\>prod-app-01\</app\_name\>             │  
│                                                       │   \<enable\_ssl\>true\</enable\_ssl\>                │  
│                                                       │   ...                                          │  
└───────────────────────────────────────────────────────┴────────────────────────────────────────────────┘

### **UI Layout Wireframe 4: Mobile & Compact Responsive View**

┌──────────────────────────────────────┐  
│ \[≡\] InfraKit Studio       \[🔍\] \[🌙\]  │  
├──────────────────────────────────────┤  
│ 🐧 Linux Kernel Sysctl Tuner         │  
├──────────────────────────────────────┤  
│ INPUTS:                              │  
│ Interface Speed Profile:             │  
│ \[ 10 Gbps Interface               ▼\] │  
│                                      │  
│ Enable BBR Congestion Control:       │  
│ \[ \[ON\]  \]                            │  
│                                      │  
│ SYN Backlog Queue:                   │  
│ \[========o─────────\] 8192            │  
├──────────────────────────────────────┤  
│ GENERATED OUTPUT:                    │  
│ ┌──────────────────────────────────┐ │  
│ │ \# /etc/sysctl.d/99-tuning.conf   │ │  
│ │ net.core.somaxconn \= 8192        │ │  
│ │ net.core.default\_qdisc \= fq      │ │  
│ │ net.ipv4.tcp\_congestion\_control  │ │  
│ │   \= bbr                          │ │  
│ └──────────────────────────────────┘ │  
│ \[ 📋 Copy Configuration            \] │  
└──────────────────────────────────────┘

## **3\. Master Module Taxonomy & Deduplicated Tool Matrix**

The application is structured into five dedicated root modules:

InfraKit Studio Root  
├── 1\. Tuning & Performance Module (tuning\_module)  
├── 2\. Daily Developer & System Utilities (tools\_module)  
├── 3\. Office & Media Suite (office\_module)  
├── 4\. FormFlow Dynamic Builder Module (form\_flow\_module)  
└── 5\. Cheatsheets & Documentation Hub (cheatsheets\_module)

### **Module 1: Tuning & Performance (tuning\_module)**

*Engineered for infrastructure baselines, capacity planning, and low-level system optimization.*

* **1.1 Linux Kernel & OS Tuning**  
  * Network Sysctl Generator (TCP buffers, BBR, somaxconn, MTU 9000).  
  * Memory & Swap Tuner (swappiness, dirty\_ratio, vfs\_cache\_pressure).  
  * System Limits Configurator (/etc/security/limits.conf for nofile / nproc).  
* **1.2 Ceph Distributed Storage**  
  * Placement Group (PG) Calculator (![][image1] power-of-2 rounding).  
  * Pool Creation & Replication Factor Builder.  
  * Cluster Network & OSD Bandwidth Estimator.  
* **1.3 Database Sizing**  
  * PostgreSQL Configuration Tuner (shared\_buffers, effective\_cache\_size, work\_mem).  
  * MariaDB / MySQL Buffer Pool Calculator (innodb\_buffer\_pool\_size).  
* **1.4 Monitoring & Telemetry**  
  * Zabbix Server Sizing (NVPS, poller allocation, database cache sizing).  
* **1.5 Network & Interface Tuning**  
  * Interface MTU & Ring Buffer Calculator (1G / 10G / 40G / 100G profiles).

### **Module 2: Daily Developer & System Utilities (tools\_module)**

*Consolidated developer, security, and networking utility tools.*

#### **2.1 Security & Cryptography**

* **SSH Key Pair Generator:** Ed25519 & RSA-4096 key generator (In-Browser WebCrypto) \+ Visual \~/.ssh/config builder (ProxyJump, IdentityFile, KeepAlive).  
* **Hash & Checksum Calculator:** MD5, SHA-1, SHA-256, SHA-512, Blake2, HMAC, and bcrypt generator/verifier.  
* **Symmetric File & Text Crypto:** Simple AES-GCM encryption/decryption with passphrase splitting & post-quantum safety notes.  
* **Password & Secret Generator:** Configurable password, passphrase, UUID (v1, v3, v4, v5), and ULID generator with password strength analyzer.  
* **Certificate & Token Tools:** X.509 PEM certificate inspector and JWT token parser/debugger.

#### **2.2 Converters & Encoders**

* **Bi-directional Data Converter:** YAML ⟷ JSON ⟷ TOML ⟷ XML.  
* **Base64 Converter:** Text and binary file encoder/decoder.  
* **Web Encoders:** URL encoder/decoder, HTML entity escaper, GZip compression.  
* **Radix & Date Converters:** Hex/Binary/Decimal/Roman converter and Unix Epoch Timestamp ⟷ ISO-8601 converter.

#### **2.3 Formatters & Testers**

* **Code Formatters:** JSON, XML, SQL, and YAML prettifier, minifier & validator.  
* **Testers & Debuggers:** Regex tester & explainer, JSONPath evaluator, side-by-side Text & JSON diff checker.

#### **2.4 Networking & SysAdmin Web Tools**

* **Subnet & IP Calculator:** IPv4 / IPv6 CIDR subnet calculator, mask bitmasking, and usable host range expander.  
* **MAC & Port Utilities:** MAC address vendor lookup & generator, IANA port reference, and firewall rule builder (UFW / Netfilter).  
* **Web Admin Utilities:** Basic Auth (htpasswd) generator, URL parser, HTTP status code reference, User-Agent parser.

#### **2.5 Text Utilities**

* **Text Manipulators:** String case converter (camelCase, snake\_case, kebab-case), slugify, line sorter, duplicate remover.  
* **Markdown & Document Utilities:** Markdown live preview with HTML export, Lorem Ipsum text generator, Chmod permissions calculator, Docker run to Docker Compose converter.

### **Module 3: Office & Media Suite (office\_module)**

*Dedicated suite for file-heavy media processing, PDF operations, and visual utilities.*

#### **3.1 PDF Document Utilities**

* **PDF Split & Merge:** Combine multiple PDF files or extract specific page ranges locally.  
* **PDF Inspector & Metadata Extractor:** View PDF metadata, encryption status, and signature validity.

#### **3.2 Image & Graphics Utilities**

* **Image Format Converter & Compressor:** Convert and compress JPEG, PNG, and WebP images client-side.  
* **EXIF Metadata Viewer:** Extract camera, GPS, and technical EXIF metadata from images.

#### **3.3 Barcodes, Colors & Visual Tools**

* **QR Code Suite:** Customizable QR code and WiFi network access QR generator.  
* **Color Tools:** Color picker/converter (Hex, RGB, HSL) and Color Blindness Simulator.

### **Module 4: FormFlow Dynamic Builder (form\_flow\_module)**

*Engineered to convert rigid XML, YAML, or JSON templates into interactive dynamic web forms.*

#### **FormFlow Architecture**

\[ Upload XML / YAML / JSON File \]  
               │  
               ▼  
   \[ Structural AST Parser \]  
  (Detects Nodes, Types & Arrays)  
               │  
               ▼  
   \[ Visual Schema Designer \]  
  \- Map field types (Text, Number, Switch, Select)  
  \- Configure Recurring Loops (Dynamic Arrays)  
  \- Set Default Values & Placeholders  
               │  
               ▼  
   \[ Save to Sidebar Library \]  
 (Stored in LocalStorage / File System)  
               │  
               ▼  
     \[ Interactive Form Runner \]  
  \- Fill fields & click \[+ Add Item\] for loops  
  \- Live output file generation (XML/YAML/JSON)

#### **Core Features**

1. **Structural Auto-Detection Engine:** Accepts raw XML/YAML/JSON files, auto-parses node trees, and maps boolean tags (\<enabled\>true\</enabled\>) to switches and strings to text inputs.  
2. **Recurring Loop Support (Dynamic Arrays):** Allows marking repeated XML/YAML tags (e.g. \<server\>\<host\>...\</host\>\</server\>) so the form renders a dynamic \[ \+ Add Item \] button for repeating structures.  
3. **Sidebar Template Library:** User-created forms can be named, saved, and accessed directly from the sidebar under "Custom Forms".

### **Module 5: Cheatsheets & Documentation Hub (cheatsheets\_module)**

*Quick-reference hub for SysAdmin, SRE, and System Design documentation.*

* **5.1 Interactive Cheatsheets**  
  * Git command cheatsheet.  
  * Regex pattern cheatsheet.  
  * Linux Sysctl & Kernel parameter reference.  
  * Crontab syntax guide.  
  * Chmod numeric permission matrix.  
* **5.2 System Design & Architecture References**  
  * Curated reference links and embedded documentation launchers for Zabbix, Ceph, PostgreSQL, Kubernetes, and Linux Kernel documentation.

## **4\. Development Roadmap (Simple to Complex)**

Development is phased from pure client-side static tools up to advanced dynamic engines:

Phase 1: Foundation & Static Utilities  
 └── Flutter Scaffolding, Responsive DevToys Grid, Dark Theme, Converters, Formatters, Hashes, UUIDs

Phase 2: Deep Tuning & Cryptography  
 └── Ceph PG Calculator, Linux Sysctl Tuner, DB Memory Sizer, Subnet Calc, SSH Keygen, SSH Config Builder

Phase 3: FormFlow Dynamic Engine  
 └── XML/YAML AST Structural Parser, Visual Form Mapping, Dynamic Loop Engine (\[+ Add Item\]), Schema Storage

Phase 4: Office & Media Suite & Cheatsheets  
 └── PDF Split/Merge, Image Compression/Conversion, EXIF Viewer, Interactive Cheatsheets Hub

Deferred (Future Phases)  
 └── Go Sidecar Execution Runner, Remote SSH PTY Terminal, AI Operations Assistant Context Engine

## **5\. Explicitly Deferred Features (Future Phases)**

To maintain client-side reliability and focus on client-first delivery:

* ❌ **Go Command Runner / Sidecar:** Deferred. All tools operate in pure browser/client-side mode.  
* ❌ **AI Assistant & Context Sidebar:** Deferred.  
* ❌ **Ansible Playbook Manager:** Deferred.

[image1]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABQAAAAZCAYAAAAxFw7TAAABh0lEQVR4Xu2TP0vDUBTFU6qCf0BQS7BJkza4GAeHgC4KTjrp4CcQFVxE0A5ioaBfQNBJunYQxEEQFdFB0MlvoQhuDkLdpP6uvOhrDNKCi5ADh9xz733n3ff6ahgJ/gyu6w7CMqzk8/kd27aH9LrjOLPkj/iO0LMML9ALlFJ63ycKhcIYDVe5XG6SeJT4DNZhURZgbhEvwRKGl+g+NcCNfBvMKHbSdEJhEZmWnGVZ/ex+T65GLRADz/Mc9CmbzkmP5NF32Wx2oMFQ7fQAX2U6LV9SU26IVlPeYuSp+ircD/u/EARBO9PsyVH08dGbYihfpSfQ55lMpkcosVwR+bUfU8agjQXH8J3NpiQhkxJvS6wMD2GZ3Iy+MBY0jdNcgxU5geR83+8IY4U0k3VpOh5cfi9G17BqmmZ3tN4SZALu5ACzXfn1o/WWEJpx3C1DPR+Mh7n46UhrU0ixuIjZusRhEr1Cfl7rawop+Qux8A0+MeVjSPSLPJfogl/hfj/segyfw4ecIMF/wgdIWF/ZH3MMFgAAAABJRU5ErkJggg==>