#ifndef AppVersion
  #define AppVersion "0.0.0"
#endif
#define AppKey "{D49B2FC5-A2D7-476C-B633-E3B161E1044E}"
[Setup]
AppId={{#AppKey}
AppName=Movies of Interest
AppVersion={#AppVersion}
VersionInfoVersion={#AppVersion}
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
var
  PreviousVersion: String;
  UpdatePage: TOutputMsgWizardPage;

function IsUpdate(): Boolean;
begin
  Result := PreviousVersion <> '';
end;

function InitializeSetup(): Boolean;
var
  Installed, Current: Int64;
begin
  Result := True;
  if not RegQueryStringValue(HKCU, 'Software\Microsoft\Windows\CurrentVersion\Uninstall\{#AppKey}_is1', 'DisplayVersion', PreviousVersion) then
    PreviousVersion := '';
  Log('Existing installation version: "' + PreviousVersion + '"; installing {#AppVersion}');
  if IsUpdate() and StrToVersion(PreviousVersion, Installed) and StrToVersion('{#AppVersion}', Current)
    and (ComparePackedVersion(Installed, Current) > 0) then
    Result := SuppressibleMsgBox('A newer version (' + PreviousVersion + ') of Movies of Interest is already installed.' + #13#10 +
      'Version {#AppVersion} may not be able to open a library saved by the newer version.' + #13#10#13#10 +
      'Install the older version anyway?', mbConfirmation, MB_YESNO or MB_DEFBUTTON2, IDNO) = IDYES;
end;

procedure InitializeWizard();
begin
  if IsUpdate() then
    UpdatePage := CreateOutputMsgPage(wpWelcome, 'Update Movies of Interest',
      'Version ' + PreviousVersion + ' is installed. Setup will update it to version {#AppVersion}.',
      'Your movie library, viewed status, notes and preferences are kept. They are stored separately from the program in:' + #13#10 +
      ExpandConstant('{localappdata}\MoviesOfInterest') + #13#10#13#10 +
      'Setup briefly stops the running app, replaces the program files and starts it again. ' +
      'The first time the new version starts, it saves a safety copy of your library in the "backups" subfolder before applying any updates.');
end;

function UpdateReadyMemo(Space, NewLine, MemoUserInfoInfo, MemoDirInfo, MemoTypeInfo, MemoComponentsInfo, MemoGroupInfo, MemoTasksInfo: String): String;
begin
  Result := MemoDirInfo;
  if IsUpdate() then
    Result := 'Update from version ' + PreviousVersion + ' to {#AppVersion}' + NewLine + 'Your library and preferences are kept.' + NewLine + NewLine + Result;
end;

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
      if MsgBox('Permanently DELETE your local movie database, its automatic backups, preferences and notes?' + #13#10 +
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
          DelTree(DataPath + '\backups', True, True, True);
          RemoveDir(DataPath);
        end;
      end;
    end;
  end;
end;
