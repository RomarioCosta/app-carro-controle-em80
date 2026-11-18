@echo off
rem Cria (ou atualiza) a tarefa no Agendador do Windows. O script ajusta o intervalo pelo que for salvo no app.
schtasks /create /tn "Buscar arquivos do carro EM80" /sc MINUTE /mo 120 /f /tr "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File \"%~dp0buscar-carro.ps1\" -Agendado"
if errorlevel 1 (echo Nao foi possivel criar o agendamento.) else (echo Agendamento ativo. A frequencia e configurada no app. Para cancelar, use "Remover agendamento.bat".)
pause
