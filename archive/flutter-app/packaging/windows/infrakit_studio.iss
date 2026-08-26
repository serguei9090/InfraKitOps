; InfraKit Studio — Windows installer (Inno Setup 6)
;
; Bundles the Flutter Windows release build together with the Flutter web
; build (copied in as a `web/` subfolder, per design.md's "adjacent folder"
; delivery model) so the installed exe can either open normally (native GUI)
; or run `infrakit_studio.exe --serve --port 8080` to headlessly serve that
; web/ folder instead — the "one binary, two modes" model documented in
; README.md.
;
; Build first: packaging\windows\build_and_package.ps1 does the full
; flutter build windows / flutter build web / copy / compile sequence. This
; script assumes build\windows\x64\runner\Release\ already has a web\
; subfolder in it by the time ISCC runs.

#define MyAppName "InfraKit Studio"
#define MyAppVersion "1.0.0"
#define MyAppPublisher "InfraKit Studio"
#define MyAppExeName "infrakit_studio.exe"
#define ReleaseDir "..\..\build\windows\x64\runner\Release"

[Setup]
AppId={{11B1A859-803B-4194-A87E-1D8331396D78}}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
DefaultDirName={autopf}\{#MyAppName}
DefaultGroupName={#MyAppName}
DisableProgramGroupPage=yes
OutputDir=..\..\build\installer
OutputBaseFilename=InfraKitStudio-Setup-{#MyAppVersion}
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
UninstallDisplayIcon={app}\{#MyAppExeName}

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "Create a &desktop shortcut"; GroupDescription: "Additional shortcuts:"

[Files]
Source: "{#ReleaseDir}\*"; DestDir: "{app}"; Flags: recursesubdirs createallsubdirs ignoreversion

[Icons]
Name: "{group}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"
Name: "{group}\{#MyAppName} (Serve as Web Server)"; Filename: "{app}\{#MyAppExeName}"; Parameters: "--serve --port 8080"; Comment: "Headlessly serve the web UI at http://localhost:8080 instead of opening a window"
Name: "{group}\Uninstall {#MyAppName}"; Filename: "{uninstallexe}"
Name: "{autodesktop}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; Tasks: desktopicon

[Run]
Filename: "{app}\{#MyAppExeName}"; Description: "Launch {#MyAppName}"; Flags: nowait postinstall skipifsilent
