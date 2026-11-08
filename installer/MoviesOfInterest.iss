#define AppVersion "1.0.1"
[Setup]
AppId={{D49B2FC5-A2D7-476C-B633-E3B161E1044E}
AppName=Movies of Interest
AppVersion={#AppVersion}
AppPublisher=SONG Labs
DefaultDirName={localappdata}\Programs\MoviesOfInterest
DefaultGroupName=Movies of Interest
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0
OutputDir=..\dist
OutputBaseFilename=MoviesOfInterest-Setup-{#AppVersion}
SetupIconFile=..\dist\MoviesOfInterest.ico
UninstallDisplayIcon={app}\MoviesOfInterest.ico
LicenseFile=..\LICENSE
WizardStyle=modern
Compression=lzma2
SolidCompression=yes
CloseApplications=yes
RestartApplications=no
DisableProgramGroupPage=yes
UninstallDisplayName=Movies of Interest

[Files]
Source: "..\dist\MoviesOfInterest.exe"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\dist\MoviesOfInterest.ico"; DestDir: "{app}"; Flags: ignoreversion
Source: "launch.vbs"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\README.md"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\LICENSE"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\dist\NODE-LICENSE.txt"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{userprograms}\Movies of Interest"; Filename: "{sys}\wscript.exe"; Parameters: """{app}\launch.vbs"" --open"; IconFilename: "{app}\MoviesOfInterest.ico"
Name: "{userdesktop}\Movies of Interest"; Filename: "{sys}\wscript.exe"; Parameters: """{app}\launch.vbs"" --open"; IconFilename: "{app}\MoviesOfInterest.ico"
Name: "{userstartup}\Movies of Interest"; Filename: "{sys}\wscript.exe"; Parameters: """{app}\launch.vbs"""; IconFilename: "{app}\MoviesOfInterest.ico"

[Run]
Filename: "{sys}\wscript.exe"; Parameters: """{app}\launch.vbs"" --open"; Flags: nowait runasoriginaluser; Description: "Open Movies of Interest in your browser"

[Code]
function StopApplication(const Directory: String): Boolean;
var
  ResultCode: Integer;
begin
  Result := True;
  if FileExists(Directory + '\MoviesOfInterest.exe') then begin
    Result := Exec(Directory + '\MoviesOfInterest.exe', '--stop', Directory, SW_HIDE, ewWaitUntilTerminated, ResultCode);
    if Result then Result := ResultCode = 0;
    Sleep(1500);
  end;
end;

function PrepareToInstall(var NeedsRestart: Boolean): String;
begin
  Result := '';
  if not StopApplication(ExpandConstant('{app}')) then
    Result := 'Could not stop Movies of Interest. Close it from Settings, then retry installation.';
end;

function InitializeUninstall(): Boolean;
begin
  Result := StopApplication(ExpandConstant('{app}'));
  if not Result then
    MsgBox('Could not stop Movies of Interest. Stop the server in its Settings tab before uninstalling.', mbError, MB_OK);
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
var
  DataPath: String;
begin
  if (CurUninstallStep = usPostUninstall) and not UninstallSilent then begin
    DataPath := ExpandConstant('{localappdata}\MoviesOfInterest');
    if FileExists(DataPath + '\library.db') then begin
      if MsgBox('Permanently DELETE your local movie database, preferences and notes?' + #13#10 +
        'This is IRREVERSIBLE without an exported backup.' + #13#10 +
        'Choose No to keep your library for a future reinstall.' + #13#10 + DataPath,
        mbConfirmation, MB_YESNO or MB_DEFBUTTON2) = IDYES then begin
        if MsgBox('Final confirmation: delete the library permanently?', mbConfirmation,
          MB_YESNO or MB_DEFBUTTON2) = IDYES then begin
          DeleteFile(DataPath + '\library.db-wal');
          DeleteFile(DataPath + '\library.db-shm');
          if not DeleteFile(DataPath + '\library.db') then
            MsgBox('Could not delete the database. Your data remains at ' + DataPath, mbError, MB_OK);
          DeleteFile(DataPath + '\app.log');
          RemoveDir(DataPath);
        end;
      end;
    end;
  end;
end;
