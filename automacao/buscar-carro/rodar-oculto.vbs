' Roda o buscar-carro.ps1 sem abrir janela.
' Sem argumento: busca agendada (-Agendado). Com o link carrocontrole://... (botao do app): -Pedido.
Set fso = CreateObject("Scripting.FileSystemObject")
pasta = fso.GetParentFolderName(WScript.ScriptFullName)
modo = " -Agendado"
If WScript.Arguments.Count > 0 Then
  If LCase(Left(WScript.Arguments(0), 14)) = "carrocontrole:" Then modo = " -Pedido"
End If
CreateObject("WScript.Shell").Run "powershell -NoProfile -ExecutionPolicy Bypass -File """ & pasta & "\buscar-carro.ps1""" & modo, 0, False
