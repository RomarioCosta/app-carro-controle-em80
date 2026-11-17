' Roda o buscar-carro.ps1 sem abrir janela (usado pelo agendamento)
Set fso = CreateObject("Scripting.FileSystemObject")
pasta = fso.GetParentFolderName(WScript.ScriptFullName)
CreateObject("WScript.Shell").Run "powershell -NoProfile -ExecutionPolicy Bypass -File """ & pasta & "\buscar-carro.ps1"" -Agendado", 0, False
