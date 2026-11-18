@echo off
rem Abre o mesmo link que o botao "Buscar agora" do app, mas direto pelo Windows (sem o navegador).
rem Se aparecer o aviso do resultado e o log ganhar uma linha "pelo link do app", o link funciona: o problema e o navegador.
echo Chamando carrocontrole://buscar ...
start "" "carrocontrole://buscar/?id=teste-bat&modo=novos"
echo.
echo Espere uns 20 segundos: deve aparecer o aviso do resultado (sem o carro: cabo nao conectado).
echo Depois veja o Log completo no app.
pause
