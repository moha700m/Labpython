; Muhammad C++ Studio — Windows installer (Inno Setup 6).
; Built by .github/workflows/desktop.yml from apps/desktop/dist/stage.
#define AppVersion GetEnv("MCS_VERSION")
#if AppVersion == ""
  #define AppVersion "0.4.0"
#endif

[Setup]
AppId={{6B0E4C2A-3F5D-4C1B-9A71-2E8D4F6C9B10}
AppName=Muhammad C++ Studio
AppVersion={#AppVersion}
AppPublisher=moha700m
AppPublisherURL=https://github.com/moha700m/Labpython
DefaultDirName={localappdata}\Programs\MuhammadCppStudio
DefaultGroupName=Muhammad C++ Studio
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
OutputDir=..\dist
OutputBaseFilename=MuhammadCppStudio-Setup
SetupIconFile=..\launcher\studio.ico
UninstallDisplayIcon={app}\MuhammadCppStudio.exe
LicenseFile=..\..\..\LICENSE
Compression=lzma2/ultra64
SolidCompression=yes
WizardStyle=modern

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"

[Files]
Source: "..\dist\stage\*"; DestDir: "{app}"; Flags: recursesubdirs createallsubdirs ignoreversion

[Icons]
Name: "{group}\Muhammad C++ Studio"; Filename: "{app}\MuhammadCppStudio.exe"
Name: "{group}\Uninstall Muhammad C++ Studio"; Filename: "{uninstallexe}"
Name: "{autodesktop}\Muhammad C++ Studio"; Filename: "{app}\MuhammadCppStudio.exe"; Tasks: desktopicon

[Run]
Filename: "{app}\MuhammadCppStudio.exe"; Description: "{cm:LaunchProgram,Muhammad C++ Studio}"; Flags: nowait postinstall skipifsilent

[UninstallRun]
Filename: "{cmd}"; Parameters: "/c taskkill /f /im MuhammadCppStudio.exe"; Flags: runhidden; RunOnceId: "StopLauncher"

[UninstallDelete]
Type: filesandordirs; Name: "{localappdata}\MuhammadCppStudio\work"
