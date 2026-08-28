/**
 * Windows Remote Desktop (`.rdp`) connection-file builder — pure TS, no I/O,
 * no React.
 *
 * A `.rdp` file is a flat list of `name:type:value` lines, where `type` is
 * `i` (integer), `s` (string) or `b` (base64 binary). `mstsc.exe` (and the
 * "Remote Desktop" store app) read it. This builder emits only the
 * properties the caller explicitly selected, so the result is a small,
 * reviewable file rather than the ~120-line dump the mstsc "Save As" button
 * produces — same philosophy as this repo's SSH / sysctl config builders.
 *
 * Deliberately NOT emitted:
 *  - `password 51:b:` — the saved-password blob is DPAPI-encrypted and bound
 *    to one user + machine; it cannot be produced portably and storing
 *    credentials in a file is a bad idea anyway. Use Windows Credential
 *    Manager (`cmdkey /generic:TERMSRV/<host> /user:<u> /pass:<p>`) or let
 *    mstsc prompt.
 *  - `signscope:s:` / `signature:s:` — these are written BY `rdpsign.exe`,
 *    not by hand (see `lockGuidance`).
 *
 * "Read-only": the `.rdp` format has no in-file lock. Two real mechanisms,
 * surfaced via `lockGuidance`:
 *  1. `attrib +R file.rdp` — marks the file read-only on disk (stops casual
 *     edits; a user can still copy it).
 *  2. `rdpsign.exe /sha256 <cert-thumbprint> file.rdp` — appends a signature
 *     that covers the security-relevant properties; any later edit breaks it.
 *     Pair with the GPO "Specify SHA1 thumbprints of certificates
 *     representing trusted .rdp publishers" so clients trust it silently.
 *
 * Property reference:
 *  - learn.microsoft.com/windows-server/remote-desktop-services/clients/rdp-files
 *  - learn.microsoft.com/azure/virtual-desktop/rdp-properties
 */

import type { IToolUseCase } from '../ports/IToolUseCase'

/** `.rdp` value token: `i` = integer line, `s` = string line. */
export type RdpFieldType = 'i' | 's'

/**
 * How the UI should render the control for a property. `boolean` and
 * `choice` still emit an `i:` line — the value set is just constrained.
 */
export type RdpValueKind = 'boolean' | 'choice' | 'integer' | 'string'

/** One selectable label for a `choice` property; `value` is the emitted int. */
export interface RdpChoice {
  value: string
  label: string
}

/**
 * One `.rdp` property descriptor. The whole UI is generic over a list of
 * these, so adding a property is a one-entry data change.
 */
export interface RdpOption {
  /** Exact property name, e.g. `screen mode id`. Case-sensitive in spirit; mstsc is lenient. */
  key: string
  /** UI section + output ordering (see `RDP_GROUP_ORDER`). */
  group: string
  kind: RdpValueKind
  /** `i` or `s` in the generated line. */
  field: RdpFieldType
  /** One-line explanation shown under the control. */
  description: string
  /** Full legal label/value set for `choice`. */
  choices?: readonly RdpChoice[]
  /** mstsc's own default, for reference. Not emitted unless selected. */
  defaultValue?: string
  /** Value used by the "Hardened / locked-down" preset. Undefined = not in the preset. */
  hardenedValue?: string
  /** Value used by the "LAN / full experience" preset. */
  lanValue?: string
  /** Placeholder for string/integer fields. */
  hint?: string
  min?: number
  max?: number
  /** Version / caveat note surfaced in the UI. */
  note?: string
}

export const RDP_GROUP_ORDER: readonly string[] = [
  'Connection',
  'Authentication & Gateway',
  'Display',
  'Local resources & devices',
  'Audio',
  'Experience & performance',
  'RemoteApp',
  'Session behavior',
]

const YES_NO = 'boolean' as const

/** The property catalog. Order within a group is the emission order. */
export const RDP_OPTION_CATALOG: readonly RdpOption[] = [
  // ------------------------------------------------------------------
  // Connection
  // ------------------------------------------------------------------
  {
    key: 'server port',
    group: 'Connection',
    kind: 'integer',
    field: 'i',
    description: 'TCP port of the RD host. Only set this if it is not the default.',
    defaultValue: '3389',
    hint: '3389',
    min: 1,
    max: 65535,
  },
  {
    key: 'alternate full address',
    group: 'Connection',
    kind: 'string',
    field: 's',
    description: 'Address used for auto-reconnect when it differs from the primary address (e.g. behind NAT).',
    hint: 'host.internal.example.com',
  },
  {
    key: 'connect to console',
    group: 'Connection',
    kind: YES_NO,
    field: 'i',
    description: 'Connect to the console/admin session (session 0) instead of a normal session.',
    defaultValue: '0',
  },
  {
    key: 'administrative session',
    group: 'Connection',
    kind: YES_NO,
    field: 'i',
    description: 'Newer spelling of "connect to console". Connect to the admin session.',
    defaultValue: '0',
    note: 'Windows 8 / Server 2012+ clients',
  },
  {
    key: 'disableconnectionsharing',
    group: 'Connection',
    kind: YES_NO,
    field: 'i',
    description: 'Always start a new session rather than reconnecting to an existing one for this user.',
    defaultValue: '0',
  },
  {
    key: 'loadbalanceinfo',
    group: 'Connection',
    kind: 'string',
    field: 's',
    description: 'Session-broker / farm routing token. For RDS collections: tsv://MS Terminal Services Plugin.1.<collection>.',
    hint: 'tsv://MS Terminal Services Plugin.1.MyCollection',
  },
  {
    key: 'targetisaadjoined',
    group: 'Connection',
    kind: YES_NO,
    field: 'i',
    description: 'The target is Microsoft Entra (Azure AD) joined — lets the client pick the right auth path.',
    defaultValue: '0',
  },
  {
    key: 'kdcproxyname',
    group: 'Connection',
    kind: 'string',
    field: 's',
    description: 'KDC proxy URL for Kerberos when the client cannot reach a domain controller directly.',
    hint: 'https://kdcproxy.example.com/KdcProxy',
  },
  {
    key: 'eventloguploadaddress',
    group: 'Connection',
    kind: 'string',
    field: 's',
    description: 'Endpoint the client uploads connection event logs to (managed / AVD scenarios).',
    hint: 'https://logs.example.com',
  },

  // ------------------------------------------------------------------
  // Authentication & Gateway
  // ------------------------------------------------------------------
  {
    key: 'username',
    group: 'Authentication & Gateway',
    kind: 'string',
    field: 's',
    description: 'Pre-filled user name. Prefix with a domain (DOMAIN\\user) or use a UPN (user@domain).',
    hint: 'CONTOSO\\jdoe',
  },
  {
    key: 'domain',
    group: 'Authentication & Gateway',
    kind: 'string',
    field: 's',
    description: 'Pre-filled logon domain. Leave blank when username is a UPN.',
    hint: 'CONTOSO',
  },
  {
    key: 'enablecredsspsupport',
    group: 'Authentication & Gateway',
    kind: YES_NO,
    field: 'i',
    description: 'Use Network Level Authentication (CredSSP) — authenticate before a session is created. Keep on.',
    defaultValue: '1',
    hardenedValue: '1',
    lanValue: '1',
  },
  {
    key: 'authentication level',
    group: 'Authentication & Gateway',
    kind: 'choice',
    field: 'i',
    choices: [
      { value: '0', label: '0 — Connect and do not warn me' },
      { value: '1', label: '1 — Do not connect if authentication fails' },
      { value: '2', label: '2 — Warn me if authentication fails' },
      { value: '3', label: '3 — No authentication requirement' },
    ],
    description: 'What to do if the host identity cannot be verified.',
    defaultValue: '2',
    hardenedValue: '1',
  },
  {
    key: 'negotiate security layer',
    group: 'Authentication & Gateway',
    kind: YES_NO,
    field: 'i',
    description: 'Negotiate the security protocol (TLS / CredSSP / RDP) with the host rather than forcing legacy RDP security.',
    defaultValue: '1',
    hardenedValue: '1',
  },
  {
    key: 'enablerdsaadauth',
    group: 'Authentication & Gateway',
    kind: YES_NO,
    field: 'i',
    description: 'Allow Microsoft Entra (Azure AD) authentication to the remote PC.',
    defaultValue: '0',
  },
  {
    key: 'prompt for credentials',
    group: 'Authentication & Gateway',
    kind: YES_NO,
    field: 'i',
    description: 'Prompt for credentials on the client before connecting instead of sending saved ones.',
    defaultValue: '0',
    hardenedValue: '1',
  },
  {
    key: 'promptcredentialonce',
    group: 'Authentication & Gateway',
    kind: YES_NO,
    field: 'i',
    description: 'Use the same credentials for the RD Gateway and the remote PC (prompt only once).',
    defaultValue: '1',
  },
  {
    key: 'enablerestrictedadminmode',
    group: 'Authentication & Gateway',
    kind: YES_NO,
    field: 'i',
    description: 'Restricted Admin mode — do not send credentials to the host (limits Pass-the-Hash exposure). Host must allow it.',
    defaultValue: '0',
    hardenedValue: '1',
    note: 'Host: DisableRestrictedAdmin must be 0',
  },
  {
    key: 'remotecredentialguard',
    group: 'Authentication & Gateway',
    kind: YES_NO,
    field: 'i',
    description: 'Remote Credential Guard — Kerberos SSO where credentials never leave the client. Domain only.',
    defaultValue: '0',
  },
  {
    key: 'gatewayhostname',
    group: 'Authentication & Gateway',
    kind: 'string',
    field: 's',
    description: 'RD Gateway (TS Gateway) FQDN to tunnel the connection through.',
    hint: 'gateway.example.com',
  },
  {
    key: 'gatewayusagemethod',
    group: 'Authentication & Gateway',
    kind: 'choice',
    field: 'i',
    choices: [
      { value: '0', label: '0 — Do not use an RD Gateway' },
      { value: '1', label: '1 — Always use an RD Gateway' },
      { value: '2', label: '2 — Use for non-local addresses only' },
      { value: '3', label: '3 — Use the RD Gateway default setting' },
    ],
    description: 'When to route through the RD Gateway named above.',
    defaultValue: '0',
  },
  {
    key: 'gatewaycredentialssource',
    group: 'Authentication & Gateway',
    kind: 'choice',
    field: 'i',
    choices: [
      { value: '0', label: '0 — Ask for password (NTLM)' },
      { value: '1', label: '1 — Smart card' },
      { value: '3', label: '3 — Pass-through (use connection credentials)' },
      { value: '4', label: '4 — Prompt / let user choose' },
      { value: '5', label: '5 — Cookie-based' },
    ],
    description: 'How the client authenticates to the RD Gateway.',
    defaultValue: '4',
  },
  {
    key: 'gatewayprofileusagemethod',
    group: 'Authentication & Gateway',
    kind: 'choice',
    field: 'i',
    choices: [
      { value: '0', label: '0 — Use the default gateway profile' },
      { value: '1', label: '1 — Use an explicit gateway profile' },
    ],
    description: 'Whether the gateway settings above override the client default profile.',
    defaultValue: '0',
  },
  {
    key: 'gatewaybrokeringtype',
    group: 'Authentication & Gateway',
    kind: 'integer',
    field: 'i',
    description: 'Gateway brokering mode. Leave 0 unless a deployment tells you otherwise.',
    defaultValue: '0',
    hint: '0',
    min: 0,
    max: 1,
  },

  // ------------------------------------------------------------------
  // Display
  // ------------------------------------------------------------------
  {
    key: 'screen mode id',
    group: 'Display',
    kind: 'choice',
    field: 'i',
    choices: [
      { value: '1', label: '1 — Windowed' },
      { value: '2', label: '2 — Full screen' },
    ],
    description: 'Start the session windowed or full screen.',
    defaultValue: '2',
  },
  {
    key: 'desktopwidth',
    group: 'Display',
    kind: 'integer',
    field: 'i',
    description: 'Session width in pixels. Ignored when dynamic resolution / smart sizing is on.',
    hint: '1920',
    min: 200,
    max: 8192,
  },
  {
    key: 'desktopheight',
    group: 'Display',
    kind: 'integer',
    field: 'i',
    description: 'Session height in pixels.',
    hint: '1080',
    min: 200,
    max: 8192,
  },
  {
    key: 'desktopscalefactor',
    group: 'Display',
    kind: 'choice',
    field: 'i',
    choices: [
      { value: '100', label: '100%' },
      { value: '125', label: '125%' },
      { value: '150', label: '150%' },
      { value: '175', label: '175%' },
      { value: '200', label: '200%' },
      { value: '250', label: '250%' },
      { value: '300', label: '300%' },
      { value: '400', label: '400%' },
      { value: '500', label: '500%' },
    ],
    description: 'DPI scale factor applied inside the session (high-DPI displays).',
    defaultValue: '100',
  },
  {
    key: 'session bpp',
    group: 'Display',
    kind: 'choice',
    field: 'i',
    choices: [
      { value: '8', label: '8 — 256 colors' },
      { value: '15', label: '15 — High color (15-bit)' },
      { value: '16', label: '16 — High color (16-bit)' },
      { value: '24', label: '24 — True color (24-bit)' },
      { value: '32', label: '32 — Highest quality (32-bit)' },
    ],
    description: 'Session color depth. Lower saves bandwidth on very slow links.',
    defaultValue: '32',
    lanValue: '32',
    hardenedValue: '16',
  },
  {
    key: 'use multimon',
    group: 'Display',
    kind: YES_NO,
    field: 'i',
    description: 'Use all local monitors in the session (true multi-monitor).',
    defaultValue: '0',
    lanValue: '1',
  },
  {
    key: 'selectedmonitors',
    group: 'Display',
    kind: 'string',
    field: 's',
    description: 'Comma-separated monitor IDs to use (from mstsc /l). Requires use multimon:i:1.',
    hint: '0,1',
  },
  {
    key: 'maximizetocurrentdisplays',
    group: 'Display',
    kind: YES_NO,
    field: 'i',
    description: 'When maximized, span the monitors the window currently touches rather than all of them.',
    defaultValue: '0',
    note: 'Windows 10 1803+ client',
  },
  {
    key: 'singlemoninwindowedmode',
    group: 'Display',
    kind: YES_NO,
    field: 'i',
    description: 'Restrict a multi-monitor session to a single monitor while windowed.',
    defaultValue: '0',
  },
  {
    key: 'smart sizing',
    group: 'Display',
    kind: YES_NO,
    field: 'i',
    description: 'Scale the remote desktop to fit the window instead of showing scrollbars.',
    defaultValue: '0',
  },
  {
    key: 'dynamic resolution',
    group: 'Display',
    kind: YES_NO,
    field: 'i',
    description: 'Let the session resolution follow the client window as it is resized.',
    defaultValue: '1',
    lanValue: '1',
  },
  {
    key: 'span monitors',
    group: 'Display',
    kind: YES_NO,
    field: 'i',
    description: 'Legacy span mode — treat all monitors as one wide surface. Prefer use multimon.',
    defaultValue: '0',
  },
  {
    key: 'winposstr',
    group: 'Display',
    kind: 'string',
    field: 's',
    description: 'Initial window placement: 0,<showcmd>,<left>,<top>,<right>,<bottom>. showcmd 1 = normal, 3 = maximized.',
    hint: '0,3,0,0,1024,768',
  },
  {
    key: 'full screen title',
    group: 'Display',
    kind: 'string',
    field: 's',
    description: 'Custom text shown in the session window title / connection bar.',
    hint: 'Production jump host',
  },
  {
    key: 'displayconnectionbar',
    group: 'Display',
    kind: YES_NO,
    field: 'i',
    description: 'Show the connection bar at the top of a full-screen session.',
    defaultValue: '1',
  },
  {
    key: 'pinconnectionbar',
    group: 'Display',
    kind: YES_NO,
    field: 'i',
    description: 'Keep the full-screen connection bar pinned (not auto-hiding).',
    defaultValue: '1',
  },

  // ------------------------------------------------------------------
  // Local resources & devices
  // ------------------------------------------------------------------
  {
    key: 'redirectclipboard',
    group: 'Local resources & devices',
    kind: YES_NO,
    field: 'i',
    description: 'Share the clipboard between local and remote.',
    defaultValue: '1',
    lanValue: '1',
    hardenedValue: '0',
  },
  {
    key: 'redirectprinters',
    group: 'Local resources & devices',
    kind: YES_NO,
    field: 'i',
    description: 'Redirect local printers into the session.',
    defaultValue: '1',
    hardenedValue: '0',
  },
  {
    key: 'redirectcomports',
    group: 'Local resources & devices',
    kind: YES_NO,
    field: 'i',
    description: 'Redirect local serial (COM) ports.',
    defaultValue: '0',
    hardenedValue: '0',
  },
  {
    key: 'redirectsmartcards',
    group: 'Local resources & devices',
    kind: YES_NO,
    field: 'i',
    description: 'Redirect local smart-card readers (needed for smart-card logon inside the session).',
    defaultValue: '1',
  },
  {
    key: 'redirectposdevices',
    group: 'Local resources & devices',
    kind: YES_NO,
    field: 'i',
    description: 'Redirect Point-of-Service devices (bar-code scanners, magnetic readers).',
    defaultValue: '0',
    hardenedValue: '0',
  },
  {
    key: 'redirectlocation',
    group: 'Local resources & devices',
    kind: YES_NO,
    field: 'i',
    description: 'Share the client device location with the session.',
    defaultValue: '0',
    hardenedValue: '0',
  },
  {
    key: 'redirectwebauthn',
    group: 'Local resources & devices',
    kind: YES_NO,
    field: 'i',
    description: 'Redirect WebAuthn (FIDO2 / passkeys / Windows Hello) requests to the local device.',
    defaultValue: '1',
    note: 'Windows 10 21H2+ client',
  },
  {
    key: 'redirectdirectx',
    group: 'Local resources & devices',
    kind: YES_NO,
    field: 'i',
    description: 'Legacy DirectX redirection flag. Present in most templates; modern GPU handling ignores it.',
    defaultValue: '1',
  },
  {
    key: 'redirectunsupporteddevices',
    group: 'Local resources & devices',
    kind: YES_NO,
    field: 'i',
    description: 'Also redirect devices the host has not explicitly allowed.',
    defaultValue: '0',
    hardenedValue: '0',
  },
  {
    key: 'drivestoredirect',
    group: 'Local resources & devices',
    kind: 'string',
    field: 's',
    description: 'Drives to redirect: * = all, DynamicDrives = plugged-in later, or a list like C:\\;D:\\. Blank = none.',
    hint: '*',
    hardenedValue: '',
  },
  {
    key: 'devicestoredirect',
    group: 'Local resources & devices',
    kind: 'string',
    field: 's',
    description: 'Plug-and-play devices to redirect: * = all supported, or specific instance IDs.',
    hint: '*',
  },
  {
    key: 'usbdevicestoredirect',
    group: 'Local resources & devices',
    kind: 'string',
    field: 's',
    description: 'RemoteFX USB devices to redirect (raw USB): * = all, or {device-class GUID} / instance paths.',
    hint: '*',
  },
  {
    key: 'camerastoredirect',
    group: 'Local resources & devices',
    kind: 'string',
    field: 's',
    description: 'Cameras to redirect: * = all, or a symbolic-link list. Blank = none.',
    hint: '*',
    hardenedValue: '',
  },
  {
    key: 'keyboardhook',
    group: 'Local resources & devices',
    kind: 'choice',
    field: 'i',
    choices: [
      { value: '0', label: '0 — On the local computer' },
      { value: '1', label: '1 — On the remote computer' },
      { value: '2', label: '2 — Only when using full screen' },
    ],
    description: 'Where Windows key combinations (Alt+Tab, Win, etc.) are sent.',
    defaultValue: '2',
  },

  // ------------------------------------------------------------------
  // Audio
  // ------------------------------------------------------------------
  {
    key: 'audiomode',
    group: 'Audio',
    kind: 'choice',
    field: 'i',
    choices: [
      { value: '0', label: '0 — Play on this computer' },
      { value: '1', label: '1 — Play on the remote computer' },
      { value: '2', label: '2 — Do not play' },
    ],
    description: 'Where session audio output goes.',
    defaultValue: '0',
    hardenedValue: '2',
  },
  {
    key: 'audiocapturemode',
    group: 'Audio',
    kind: YES_NO,
    field: 'i',
    description: 'Redirect the local microphone into the session.',
    defaultValue: '0',
    hardenedValue: '0',
  },
  {
    key: 'audioqualitymode',
    group: 'Audio',
    kind: 'choice',
    field: 'i',
    choices: [
      { value: '0', label: '0 — Dynamic (adjust to bandwidth)' },
      { value: '1', label: '1 — Medium' },
      { value: '2', label: '2 — High (uncompressed)' },
    ],
    description: 'Audio playback quality / compression trade-off.',
    defaultValue: '0',
  },

  // ------------------------------------------------------------------
  // Experience & performance
  // ------------------------------------------------------------------
  {
    key: 'connection type',
    group: 'Experience & performance',
    kind: 'choice',
    field: 'i',
    choices: [
      { value: '1', label: '1 — Modem (56 kbps)' },
      { value: '2', label: '2 — Low-speed broadband (256 kbps – 2 Mbps)' },
      { value: '3', label: '3 — Satellite (2 – 16 Mbps, high latency)' },
      { value: '4', label: '4 — High-speed broadband (2 – 10 Mbps)' },
      { value: '5', label: '5 — WAN (10 Mbps+, high latency)' },
      { value: '6', label: '6 — LAN (10 Mbps+)' },
      { value: '7', label: '7 — Detect connection quality automatically' },
    ],
    description: 'Seeds the experience defaults below. Overridden at runtime when networkautodetect is on.',
    defaultValue: '7',
    lanValue: '6',
  },
  {
    key: 'networkautodetect',
    group: 'Experience & performance',
    kind: YES_NO,
    field: 'i',
    description: 'Measure link quality at connect time and adapt.',
    defaultValue: '1',
  },
  {
    key: 'bandwidthautodetect',
    group: 'Experience & performance',
    kind: YES_NO,
    field: 'i',
    description: 'Continuously auto-detect available bandwidth during the session.',
    defaultValue: '1',
  },
  {
    key: 'compression',
    group: 'Experience & performance',
    kind: YES_NO,
    field: 'i',
    description: 'Enable bulk compression of the RDP stream.',
    defaultValue: '1',
    lanValue: '1',
  },
  {
    key: 'videoplaybackmode',
    group: 'Experience & performance',
    kind: YES_NO,
    field: 'i',
    description: 'Use the efficient multimedia (H.264/AVC) video pipeline for motion content.',
    defaultValue: '1',
    lanValue: '1',
  },
  {
    key: 'disable wallpaper',
    group: 'Experience & performance',
    kind: YES_NO,
    field: 'i',
    description: 'Hide the remote desktop wallpaper to save bandwidth.',
    defaultValue: '0',
  },
  {
    key: 'allow font smoothing',
    group: 'Experience & performance',
    kind: YES_NO,
    field: 'i',
    description: 'Allow ClearType font smoothing in the session.',
    defaultValue: '1',
    lanValue: '1',
  },
  {
    key: 'allow desktop composition',
    group: 'Experience & performance',
    kind: YES_NO,
    field: 'i',
    description: 'Allow desktop composition (Aero-style visual effects). Legacy; costs bandwidth.',
    defaultValue: '0',
  },
  {
    key: 'disable full window drag',
    group: 'Experience & performance',
    kind: YES_NO,
    field: 'i',
    description: 'Show only a window outline while dragging (1 = show outline only).',
    defaultValue: '1',
  },
  {
    key: 'disable menu anims',
    group: 'Experience & performance',
    kind: YES_NO,
    field: 'i',
    description: 'Disable menu and window animations in the session (1 = disabled).',
    defaultValue: '1',
  },
  {
    key: 'disable themes',
    group: 'Experience & performance',
    kind: YES_NO,
    field: 'i',
    description: 'Disable visual themes in the session (1 = disabled).',
    defaultValue: '0',
  },
  {
    key: 'disable cursor setting',
    group: 'Experience & performance',
    kind: YES_NO,
    field: 'i',
    description: 'Disable cursor blink / shadow effects (1 = disabled).',
    defaultValue: '0',
  },
  {
    key: 'bitmapcachepersistenable',
    group: 'Experience & performance',
    kind: YES_NO,
    field: 'i',
    description: 'Keep the bitmap cache on disk between sessions to speed up reconnects.',
    defaultValue: '1',
    lanValue: '1',
  },

  // ------------------------------------------------------------------
  // RemoteApp
  // ------------------------------------------------------------------
  {
    key: 'remoteapplicationmode',
    group: 'RemoteApp',
    kind: YES_NO,
    field: 'i',
    description: 'Launch a single published application (RemoteApp) instead of a full desktop.',
    defaultValue: '0',
  },
  {
    key: 'remoteapplicationname',
    group: 'RemoteApp',
    kind: 'string',
    field: 's',
    description: 'Display name shown for the RemoteApp while it starts.',
    hint: 'Line-of-business App',
  },
  {
    key: 'remoteapplicationprogram',
    group: 'RemoteApp',
    kind: 'string',
    field: 's',
    description: 'The published app alias (||AppAlias) or full path to the executable on the host.',
    hint: '||MyApp',
  },
  {
    key: 'remoteapplicationcmdline',
    group: 'RemoteApp',
    kind: 'string',
    field: 's',
    description: 'Command-line arguments passed to the RemoteApp.',
    hint: '/flag "C:\\path\\file"',
  },
  {
    key: 'remoteapplicationexpandcmdline',
    group: 'RemoteApp',
    kind: YES_NO,
    field: 'i',
    description: 'Expand environment variables in the RemoteApp command line.',
    defaultValue: '1',
  },
  {
    key: 'remoteapplicationexpandworkingdir',
    group: 'RemoteApp',
    kind: YES_NO,
    field: 'i',
    description: 'Expand environment variables in the RemoteApp working directory.',
    defaultValue: '1',
  },
  {
    key: 'remoteapplicationfile',
    group: 'RemoteApp',
    kind: 'string',
    field: 's',
    description: 'A file on the client to open with the RemoteApp (it is redirected to the host).',
    hint: 'C:\\Users\\me\\report.xlsx',
  },
  {
    key: 'remoteapplicationicon',
    group: 'RemoteApp',
    kind: 'string',
    field: 's',
    description: 'Icon file to show for the RemoteApp.',
    hint: 'C:\\path\\app.ico',
  },
  {
    key: 'disableremoteappcapscheck',
    group: 'RemoteApp',
    kind: YES_NO,
    field: 'i',
    description: 'Skip the check that the host supports RemoteApp before connecting.',
    defaultValue: '0',
  },

  // ------------------------------------------------------------------
  // Session behavior
  // ------------------------------------------------------------------
  {
    key: 'autoreconnection enabled',
    group: 'Session behavior',
    kind: YES_NO,
    field: 'i',
    description: 'Automatically try to reconnect if the connection drops.',
    defaultValue: '1',
    lanValue: '1',
  },
  {
    key: 'autoreconnect max retries',
    group: 'Session behavior',
    kind: 'integer',
    field: 'i',
    description: 'How many times to retry an auto-reconnect before giving up.',
    defaultValue: '20',
    hint: '20',
    min: 0,
    max: 200,
  },
  {
    key: 'bitmapcachesize',
    group: 'Session behavior',
    kind: 'integer',
    field: 'i',
    description: 'In-memory bitmap cache size in KB.',
    hint: '1500',
    min: 0,
    max: 32768,
  },
  {
    key: 'alternate shell',
    group: 'Session behavior',
    kind: 'string',
    field: 's',
    description: 'Program to run instead of the desktop shell (a "kiosk" session). Ignored in RemoteApp mode.',
    hint: 'C:\\Windows\\System32\\cmd.exe',
  },
  {
    key: 'shell working directory',
    group: 'Session behavior',
    kind: 'string',
    field: 's',
    description: 'Working directory for "alternate shell".',
    hint: 'C:\\',
  },
  {
    key: 'prompt for credentials on client',
    group: 'Session behavior',
    kind: YES_NO,
    field: 'i',
    description: 'Legacy flag: force the credential prompt to appear on the client (older clients).',
    defaultValue: '0',
  },
]

/** Options in `group`, in catalog (emission) order. */
export function rdpOptionsInGroup(group: string): RdpOption[] {
  return RDP_OPTION_CATALOG.filter((o) => o.group === group)
}

/** All options in emission order (group order first, then catalog order). */
export function rdpOptionsOrdered(): RdpOption[] {
  const out: RdpOption[] = []
  for (const group of RDP_GROUP_ORDER) out.push(...rdpOptionsInGroup(group))
  return out
}

/** The descriptor for `key`, or undefined if not in the catalog. */
export function rdpOptionFor(key: string): RdpOption | undefined {
  return RDP_OPTION_CATALOG.find((o) => o.key === key)
}

/**
 * "Hardened / locked-down" preset: every catalog option that has a
 * `hardenedValue`, mapped to it. A starting point — redirection off, NLA on,
 * strict host auth, no audio.
 */
export function rdpHardenedBaseline(): Record<string, string> {
  const out: Record<string, string> = {}
  for (const o of RDP_OPTION_CATALOG) if (o.hardenedValue != null) out[o.key] = o.hardenedValue
  return out
}

/** "LAN / full experience" preset: every option that has a `lanValue`. */
export function rdpLanBaseline(): Record<string, string> {
  const out: Record<string, string> = {}
  for (const o of RDP_OPTION_CATALOG) if (o.lanValue != null) out[o.key] = o.lanValue
  return out
}

export interface RdpFileBuilderInput {
  /**
   * The RD host — `host`, `host:port`, or an IP. Emitted as
   * `full address:s:<value>` and always first. Required.
   */
  address: string
  /** Selected properties keyed by exact `.rdp` property name. */
  values?: Record<string, string>
  /** Emit the explanatory `# ...` header (comments are `mstsc`-safe). Default true. */
  includeHeader?: boolean
  /**
   * Append a "how to make this read-only / tamper-proof" block to the header:
   * `attrib +R` on disk, and `rdpsign.exe /sha256 <thumbprint>` for a
   * signature that locks the security-relevant fields.
   */
  lockGuidance?: boolean
  /** Suggested save-as name. Default `connection.rdp`. */
  fileName?: string
}

export interface RdpFileBuilderResult {
  /** The rendered `.rdp` file text (CRLF line endings). */
  fileText: string
  /** Suggested file name for a save dialog. */
  suggestedFileName: string
  /** Non-fatal advisories. Never blocks generation. */
  warnings: string[]
}

const CRLF = '\r\n'

/**
 * Builds a Windows `.rdp` connection file from a required host address plus a
 * set of catalog-validated properties.
 *
 * Every value is checked against its `RdpOption` descriptor: a `choice` can
 * never emit a value outside its list, a `boolean` only ever emits `0` or
 * `1`, an `integer` is range-checked, and a `string` may not contain a
 * newline (a `.rdp` line is single-line by definition). Violations throw.
 */
export class RdpFileBuilder implements IToolUseCase<RdpFileBuilderInput, RdpFileBuilderResult> {
  execute(input: RdpFileBuilderInput): RdpFileBuilderResult {
    const address = input.address.trim()
    if (address.length === 0) {
      throw new Error('A host address is required (full address).')
    }
    if (/[\r\n]/.test(address)) {
      throw new Error('The host address must be a single line.')
    }

    const values = input.values ?? {}
    const includeHeader = input.includeHeader ?? true
    const warnings: string[] = []

    const known = new Set(RDP_OPTION_CATALOG.map((o) => o.key))
    for (const key of Object.keys(values)) {
      if (!known.has(key)) {
        throw new Error(`"${key}" is not a known .rdp property in this catalog.`)
      }
    }

    const lines: string[] = []
    lines.push(`full address:s:${address}`)

    for (const option of rdpOptionsOrdered()) {
      const raw = values[option.key]
      if (raw == null) continue
      const value = this.validate(option, raw)
      // An empty string is a legitimate value ("redirect nothing") — keep the line.
      lines.push(`${option.key}:${option.field}:${value}`)
    }

    this.collectWarnings(values, warnings)

    const header = includeHeader ? this.renderHeader(input.lockGuidance ?? false) : ''
    const fileText = header + lines.join(CRLF) + CRLF

    return {
      fileText,
      suggestedFileName: this.normalizeFileName(input.fileName),
      warnings,
    }
  }

  private normalizeFileName(name: string | undefined): string {
    const trimmed = (name ?? '').trim()
    if (trimmed.length === 0) return 'connection.rdp'
    // Preserve the base name's case; normalise only the extension.
    return trimmed.toLowerCase().endsWith('.rdp') ? `${trimmed.slice(0, -4)}.rdp` : `${trimmed}.rdp`
  }

  private renderHeader(lockGuidance: boolean): string {
    const out: string[] = [
      '# Windows Remote Desktop connection file — generated by InfraKit Studio',
      '#',
      '# Open with:  mstsc.exe connection.rdp     (or double-click)',
      '# Inspect the effective values first — this file is plain text.',
      '#',
      '# Credentials are NOT stored here. Either let mstsc prompt, or pre-stage them:',
      '#   cmdkey /generic:TERMSRV/<host> /user:<user> /pass:<password>',
      '#',
    ]
    if (lockGuidance) {
      out.push(
        '# Make this file read-only / tamper-resistant:',
        '#   1) Read-only on disk (stops casual edits):',
        '#        attrib +R connection.rdp',
        '#   2) Cryptographically sign it (any later edit invalidates the signature):',
        '#        rdpsign.exe /sha256 <certificate-thumbprint> connection.rdp',
        '#      Then trust the publisher via GPO: Computer Configuration > Administrative',
        '#      Templates > Windows Components > Remote Desktop Services > Remote Desktop',
        '#      Connection Client > "Specify SHA1 thumbprints of certificates representing',
        '#      trusted .rdp publishers".',
        '#',
      )
    }
    return out.join(CRLF) + CRLF
  }

  private collectWarnings(values: Record<string, string>, warnings: string[]): void {
    const on = (k: string) => values[k]?.trim() === '1'
    const val = (k: string) => values[k]?.trim()

    if (val('enablecredsspsupport') === '0') {
      warnings.push(
        'enablecredsspsupport:i:0 disables Network Level Authentication — the host authenticates you only ' +
          'after creating a session, which is weaker. Leave it at 1 unless a legacy host truly needs it.',
      )
    }
    if (val('authentication level') === '0' || val('authentication level') === '3') {
      warnings.push(
        `authentication level:i:${val('authentication level')} means a spoofed or MITM'd host is accepted ` +
          'without warning. Prefer 1 (do not connect) or 2 (warn).',
      )
    }
    if (values.drivestoredirect?.trim() === '*') {
      warnings.push('drivestoredirect:s:* shares every local drive with the remote host, including removable media.')
    }
    if (on('redirectsmartcards') === false && val('gatewaycredentialssource') === '1') {
      warnings.push('Gateway credentials source is Smart card (1) but smart-card redirection is off — logon may fail.')
    }
    if (on('use multimon') === false && (values.selectedmonitors?.trim().length ?? 0) > 0) {
      warnings.push('selectedmonitors is set but use multimon:i:1 is not — the monitor list is ignored.')
    }
    if (on('remoteapplicationmode') && (values.remoteapplicationprogram?.trim().length ?? 0) === 0) {
      warnings.push('remoteapplicationmode:i:1 without remoteapplicationprogram — nothing will launch.')
    }
    if ((values['alternate shell']?.trim().length ?? 0) > 0 && on('remoteapplicationmode')) {
      warnings.push('Both "alternate shell" and RemoteApp mode are set — RemoteApp mode wins and alternate shell is ignored.')
    }
  }

  /** Canonicalises and enum/range-checks one value. Throws on anything illegal. */
  private validate(option: RdpOption, raw: string): string {
    const value = raw.trim()
    if (/[\r\n]/.test(value)) {
      throw new Error(`${option.key}: value must be a single line.`)
    }

    switch (option.kind) {
      case 'boolean': {
        if (value !== '0' && value !== '1') {
          const lower = value.toLowerCase()
          if (lower === 'yes' || lower === 'true') return '1'
          if (lower === 'no' || lower === 'false') return '0'
          throw new Error(`${option.key}: must be 0 or 1 (got "${value}").`)
        }
        return value
      }
      case 'choice': {
        for (const choice of option.choices ?? []) {
          if (choice.value === value) return value
        }
        throw new Error(
          `${option.key}: must be one of ${(option.choices ?? []).map((c) => c.value).join(', ')} (got "${value}").`,
        )
      }
      case 'integer': {
        if (!/^-?\d+$/.test(value)) {
          throw new Error(`${option.key}: must be a whole number (got "${value}").`)
        }
        const parsed = Number.parseInt(value, 10)
        if (option.min != null && parsed < option.min) {
          throw new Error(`${option.key}: must be at least ${option.min} (got ${parsed}).`)
        }
        if (option.max != null && parsed > option.max) {
          throw new Error(`${option.key}: must be at most ${option.max} (got ${parsed}).`)
        }
        return `${parsed}`
      }
      case 'string': {
        return value
      }
    }
  }
}
