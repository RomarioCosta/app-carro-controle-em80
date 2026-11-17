@echo off
rem Cria (ou atualiza) a tarefa no Agendador do Windows: verifica a cada 15 min.
rem O intervalo de verdade (ex.: 2 horas) e o horario sao configurados no app (Montagem > Arquivos do carro).
schtasks /create /tn "Buscar arquivos do carro EM80" /sc MINUTE /mo 15 /f /tr "wscript.exe \"%~dp0rodar-oculto.vbs\""
if errorlevel 1 (echo Nao foi possivel criar o agendamento.) else (echo Agendamento ativo. A frequencia das buscas e configurada no app. Para cancelar, use "Remover agendamento.bat".)
pause
