@echo off
rem Duplo clique aqui. Roda o buscar-carro.ps1 que esta na mesma pasta.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0buscar-carro.ps1"
rem Se o script der erro, a janela fica aberta para ler a mensagem.
if errorlevel 1 (
  echo.
  echo O script terminou com erro. Tire um print desta janela.
  pause
)
