@echo off
rem Cria a tarefa no Agendador do Windows: roda o buscar-carro.ps1 a cada 2 horas (com voce logado).
schtasks /create /tn "Buscar arquivos do carro EM80" /sc HOURLY /mo 2 /f /tr "wscript.exe \"%~dp0rodar-oculto.vbs\""
if errorlevel 1 (echo Nao foi possivel criar o agendamento.) else (echo Agendado: a cada 2 horas. Para cancelar, use "Remover agendamento.bat".)
pause
