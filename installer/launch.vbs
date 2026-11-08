Option Explicit
Dim shell, fso, executable, arguments, exitCode, attempts
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
executable = fso.BuildPath(fso.GetParentFolderName(WScript.ScriptFullName), "MoviesOfInterest.exe")
arguments = ""
If WScript.Arguments.Count > 0 Then
  If WScript.Arguments(0) = "--open" Then arguments = " --open"
End If
attempts = 0
Do
  exitCode = shell.Run("""" & executable & """" & arguments, 0, True)
  If exitCode = 0 Then Exit Do
  attempts = attempts + 1
  If attempts >= 5 Then
    shell.Popup "Movies of Interest could not start. See %LOCALAPPDATA%\MoviesOfInterest\app.log. Launch it from the Start menu to try again.", 30, "Movies of Interest", 48
    Exit Do
  End If
  WScript.Sleep 5000
  arguments = ""
Loop
