' Start ComfyUI without a console window.
'
' Copy this file next to run_nvidia_gpu.bat in the ComfyUI portable folder and
' double-click it. It resolves its own folder, so no path needs editing.
' Output is redirected to comfyui.log in the same folder.
Option Explicit

Dim shell, fso, base, logFile, q, cmd
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

base = fso.GetParentFolderName(WScript.ScriptFullName)
logFile = base & "\comfyui.log"
q = Chr(34)

If Not fso.FileExists(base & "\ComfyUI\main.py") Then
  MsgBox "ComfyUI\main.py not found next to this script:" & vbCrLf & base, 16, "ComfyUI"
  WScript.Quit 1
End If

shell.CurrentDirectory = base
cmd = "cmd /c cd /d " & q & base & q & " && " & q & ".\python_embeded\python.exe" & q & _
      " -s ComfyUI\main.py --windows-standalone-build > " & q & logFile & q & " 2>&1"

' 0 = hidden window, False = do not wait for it to exit
shell.Run cmd, 0, False
