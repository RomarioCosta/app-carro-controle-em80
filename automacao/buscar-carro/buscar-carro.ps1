# =====================================================================
#  CARRO-CONTROLE-EM80-SCRIPT  (marca usada pela atualizacao automatica)
#  Buscar arquivos do Carro Controle EM80
#  1) confere se ha cabo de rede  2) desconecta o Wi-Fi
#  3) copia os CSV novos (ignora os de teste)  4) reconecta o Wi-Fi
#  5) avisa numa janela quantos arquivos novos vieram (ou que nao ha).
#
#  NAO edite este arquivo: ele se atualiza sozinho pelo GitHub.
#  Configuracao: pelo app (Montagem > Arquivos do carro), que grava
#  Documentos\Carro Controle\configuracao.json; ou em "configuracao.ps1" (mesma pasta).
#  O agendamento do Windows roda no intervalo configurado (ex.: 2 h),
#  chamando o PowerShell direto (sem .vbs, que a empresa pode bloquear).
#  App (aba "Buscar do carro") -> link carrocontrole://buscar/?de=..&ate=..&sedes=..
#  ou carrocontrole://config/?intervalo=..  -> este script com -Url "<link>"
#  (o link e registrado aqui, sem administrador). O app so le a pasta.
#  Nome dos arquivos do carro: RAMAL_SEDE_AAAAMMDD (ex.: RLT_CP_20261117).
# =====================================================================
param([switch]$Agendado, [switch]$SemAtualizar, [switch]$Pedido, [string]$Url = '')
$Versao = '2026-11-18.14'

# carrocontrole://acao/?a=1&b=2 -> @{ acao = 'acao'; a = '1'; b = '2' }
function LerUrl($u) {
  $r = @{ acao = '' }
  if ($u -match '^carrocontrole:/*([A-Za-z]+)/?\??(.*)$') {
    $r.acao = $Matches[1].ToLower()
    foreach ($par in ($Matches[2] -split '&')) {
      if (-not $par) { continue }
      $kv = $par -split '=', 2
      $v = if ($kv.Count -gt 1) { [Uri]::UnescapeDataString($kv[1].Replace('+', ' ')) } else { '' }
      $r[[Uri]::UnescapeDataString($kv[0])] = $v
    }
  }
  return $r
}
# Registro logo no inicio (antes de qualquer outra coisa): mostra no log que o Windows chamou o script
try {
  $logInicio = Join-Path (Join-Path ([Environment]::GetFolderPath('MyDocuments')) 'Carro Controle') 'log.txt'
  $como = if ($Url) { " pelo link do app: $Url" } elseif ($Agendado) { ' pelo agendamento' } else { ' (manual)' }
  # o agendamento roda a cada minuto (para atender o app); so registra quando nao e agendado
  if (-not $Agendado) { Add-Content -LiteralPath $logInicio -Value ('{0:dd/MM/yyyy HH:mm:ss}  Script iniciado{1}' -f (Get-Date), $como) -Encoding UTF8 -ErrorAction Stop }
} catch { }
$UrlDados = $null
if ($Url) { $UrlDados = LerUrl $Url; $Pedido = $true }
$Silencioso = $Agendado -or $Pedido   # sem janela de console (agendado ou pedido do app)

# ---------------- PADROES (sobrescritos por configuracao.ps1) ----------------
$Origens       = @()                                       # pastas dos computadores do carro
$Filtro        = '*.csv'
$Ignorar       = @('teste')                                # texto no nome = arquivo desprezado
$Dias          = 10                                        # 0 = todos
$Destino       = Join-Path ([Environment]::GetFolderPath('MyDocuments')) 'Carro Controle'   # a pasta Documentos de verdade (inclusive no OneDrive)
$EsperaRede    = 45
$ExigirCabo    = $true
$AvisarSemCabo = $true
$SegundosAviso = 30
$ModoWifi      = 'desconectar'                             # ou 'desativar' (administrador)
$NomeAdaptador = 'Wi-Fi'
$AtualizarAuto = $true                                     # baixa a versao nova do GitHub antes de buscar
$ApiUrl        = ''                                        # servidor do app (vem do app ao salvar a configuracao)
$ApiToken      = ''
$Ativo         = $true                                     # busca automatica ligada
$IntervaloMin  = 120                                       # intervalo entre buscas agendadas
$HoraIni       = ''                                        # 'HH:mm' (vazio = dia todo)
$HoraFim       = ''
$Avisos        = 'sempre'                                  # 'sempre' | 'novos' | 'nunca' (buscas agendadas)
$NomeTarefa    = 'Buscar arquivos do carro EM80'
$UrlBase       = 'https://raw.githubusercontent.com/RomarioCosta/app-carro-controle-em80/main/automacao/buscar-carro/'
# ------------------------------------------------------------------------------

$Pasta = $PSScriptRoot
$Config = Join-Path $Pasta 'configuracao.ps1'
if (Test-Path -LiteralPath $Config) { . $Config }

$ErrorActionPreference = 'Stop'
# PowerShell 5.1: sem isto, listas viram {"value":[...],"Count":n} no JSON (o app le estado.json)
try { Remove-TypeData -TypeName System.Array -ErrorAction Stop } catch { }
$Titulo  = 'Carro Controle EM80'
# Versoes anteriores gravavam em %USERPROFILE%\Documents; com o OneDrive a pasta Documentos e outra: muda para la
$antiga = Join-Path $env:USERPROFILE 'Documents\Carro Controle'
if ($Destino -ne $antiga -and (Test-Path -LiteralPath $antiga) -and -not (Test-Path -LiteralPath $Destino)) {
  try { Move-Item -LiteralPath $antiga -Destination $Destino } catch { }
}
$Todos   = Join-Path $Destino 'Todos'
$Novos   = Join-Path $Destino 'Novos'
$FilaEnvio = Join-Path $Destino 'envio-pendente.txt'      # CSV copiados que ainda nao foram para o app (Google Drive)
$TentativaEnvio = Join-Path $Destino 'envio-tentativa.txt'
$Indice  = Join-Path $Destino 'copiados.txt'
$Log     = Join-Path $Destino 'log.txt'
New-Item -ItemType Directory -Force -Path $Todos, $Novos | Out-Null

function Escrever($msg, $cor = 'Gray') {
  $linha = '{0:dd/MM/yyyy HH:mm:ss}  {1}' -f (Get-Date), $msg
  if (-not $Silencioso) { Write-Host $linha -ForegroundColor $cor }
  Add-Content -Path $Log -Value $linha -Encoding UTF8
}

# Janela de aviso que fecha sozinha (64 = informacao, 48 = atencao)
# Notificacao do Windows (canto da tela), usada se a janela de aviso nao abrir
function AvisarNotificacao($msg) {
  [void][Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime]
  $tpl = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText02)
  $t = $tpl.GetElementsByTagName('text')
  [void]$t.Item(0).AppendChild($tpl.CreateTextNode($Titulo))
  [void]$t.Item(1).AppendChild($tpl.CreateTextNode($msg))
  $appId = '{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\WindowsPowerShell\v1.0\powershell.exe'
  [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($appId).Show([Windows.UI.Notifications.ToastNotification]::new($tpl))
}

function Avisar($msg, $icone = 64) {
  try {
    (New-Object -ComObject WScript.Shell).Popup($msg, $SegundosAviso, $Titulo, $icone) | Out-Null
    Escrever 'Aviso mostrado.'
  } catch {
    Escrever "A janela de aviso nao abriu ($($_.Exception.Message)); usando a notificacao do Windows." 'Yellow'
    try { AvisarNotificacao $msg } catch { Escrever "A notificacao tambem falhou: $($_.Exception.Message)" 'Yellow' }
  }
}

function Fim($cod = 0) {
  if (-not $Silencioso) { Write-Host ''; Read-Host 'Enter para fechar' | Out-Null }
  exit $cod
}

# ---------- Configuracao do app (configuracao.json) e estado da ultima busca (estado.json) ----------
$ConfigJson = Join-Path $Destino 'configuracao.json'
$EstadoArq  = Join-Path $Destino 'estado.json'
$erroConfig = $null
if (Test-Path -LiteralPath $ConfigJson) {
  try {
    $j = [IO.File]::ReadAllText($ConfigJson) | ConvertFrom-Json
    if ($null -ne $j.ativo)         { $Ativo = [bool]$j.ativo }
    if ($j.intervaloMin)            { $IntervaloMin = [int]$j.intervaloMin }
    if ($null -ne $j.horaIni)       { $HoraIni = [string]$j.horaIni }
    if ($null -ne $j.horaFim)       { $HoraFim = [string]$j.horaFim }
    if (@($j.origens | Where-Object { $_ }).Count -gt 0) { $Origens = @($j.origens | Where-Object { $_ }) }
    if ($null -ne $j.ignorar)       { $Ignorar = @($j.ignorar | Where-Object { $_ }) }
    if ($null -ne $j.dias)          { $Dias = [int]$j.dias }
    if ($j.avisos)                  { $Avisos = [string]$j.avisos }
    if ($null -ne $j.avisarSemCabo) { $AvisarSemCabo = [bool]$j.avisarSemCabo }
    if ($j.segundosAviso)           { $SegundosAviso = [int]$j.segundosAviso }
    if ($j.modoWifi)                { $ModoWifi = [string]$j.modoWifi }
    if ($null -ne $j.atualizarAuto) { $AtualizarAuto = [bool]$j.atualizarAuto }
    if ($j.apiUrl)                  { $ApiUrl = [string]$j.apiUrl }
    if ($j.apiToken)                { $ApiToken = [string]$j.apiToken }
  } catch { $erroConfig = $_.Exception.Message }
}
$estadoAnt = $null
if (Test-Path -LiteralPath $EstadoArq) { try { $estadoAnt = [IO.File]::ReadAllText($EstadoArq) | ConvertFrom-Json } catch { } }
$agenda = if ($estadoAnt -and $estadoAnt.agenda) { [string]$estadoAnt.agenda } else { '' }
$pedidoId = $null
$copiadosAgora = New-Object System.Collections.ArrayList

function GravarEstado($resultado, $qNovos = 0, $qTestes = 0, $qErros = 0, $listaSemAcesso = @(), $mensagem = '') {
  try {
    $pend = @(Get-ChildItem -LiteralPath $Novos -File -ErrorAction SilentlyContinue).Count
    $obj = [ordered]@{
      versao = $Versao; destino = $Destino; ultimaBusca = (Get-Date).ToString("yyyy-MM-dd'T'HH:mm:ssK"); resultado = $resultado
      novos = $qNovos; testes = $qTestes; erros = $qErros; semAcesso = @($listaSemAcesso); pendentes = $pend
      mensagem = $mensagem; agendado = [bool]$Agendado; agenda = $agenda
      pedidoId = $script:pedidoId; copiados = @($script:copiadosAgora)
      config = [ordered]@{
        ativo = $Ativo; intervaloMin = $IntervaloMin; horaIni = $HoraIni; horaFim = $HoraFim
        origens = @($Origens); ignorar = @($Ignorar); dias = $Dias; avisos = $Avisos
        avisarSemCabo = $AvisarSemCabo; segundosAviso = $SegundosAviso; modoWifi = $ModoWifi; atualizarAuto = $AtualizarAuto
      }
    }
    [IO.File]::WriteAllText($EstadoArq, ($obj | ConvertTo-Json -Depth 5), (New-Object Text.UTF8Encoding $false))
  } catch { }
  # Historico: uma linha JSON por busca (o app mostra na aba Buscar do carro)
  try {
    $hist = Join-Path $Destino 'historico.jsonl'
    $tipo = if ($UrlDados) { 'app' } elseif ($Agendado) { 'automatica' } else { 'manual' }
    $linha = [ordered]@{
      data = (Get-Date).ToString("yyyy-MM-dd'T'HH:mm:ssK"); tipo = $tipo; resultado = $resultado
      novos = $qNovos; testes = $qTestes; erros = $qErros; semAcesso = @($listaSemAcesso)
      copiados = @($script:copiadosAgora | Select-Object -First 30); mensagem = $mensagem; versao = $Versao
    }
    $utf8 = New-Object Text.UTF8Encoding $false
    [IO.File]::AppendAllText($hist, (($linha | ConvertTo-Json -Depth 4 -Compress) + "`n"), $utf8)
    if ((Get-Item -LiteralPath $hist).Length -gt 300KB) {   # guarda so as ultimas 500 buscas
      $ult = @([IO.File]::ReadAllLines($hist, $utf8) | Select-Object -Last 500)
      [IO.File]::WriteAllLines($hist, [string[]]$ult, $utf8)
    }
  } catch { }
}

# ---------- Pedidos do app pela pasta Downloads ----------
# O app nao abre programas: o botao "Buscar agora" baixa carro-controle-pedido.json e o "Salvar configuracao"
# baixa carro-controle-config.json. O agendamento (a cada minuto) pega esses arquivos e os apaga.
function PastaDownloads {
  try {
    $v = (Get-ItemProperty -LiteralPath 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\User Shell Folders' -ErrorAction Stop).'{374DE290-123F-4565-9164-39C4925E467B}'
    if ($v) { $v = [Environment]::ExpandEnvironmentVariables($v); if (Test-Path -LiteralPath $v) { return $v } }
  } catch { }
  return (Join-Path $env:USERPROFILE 'Downloads')
}
function LerPedidoBaixado($prefixo) {
  $dl = PastaDownloads
  $arqs = @(Get-ChildItem -LiteralPath $dl -File -Filter "$prefixo*.json" -ErrorAction SilentlyContinue | Sort-Object LastWriteTime)
  if (-not $arqs.Count) { return $null }
  $d = $null
  try {
    $j = [IO.File]::ReadAllText($arqs[-1].FullName) | ConvertFrom-Json
    $d = @{}
    $j.PSObject.Properties | ForEach-Object { $d[$_.Name] = [string]$_.Value }
  } catch { $d = $null }
  $arqs | ForEach-Object { Remove-Item -LiteralPath $_.FullName -Force -ErrorAction SilentlyContinue }
  # pedido velho (mais de 30 min) e ignorado
  if ($d -and ((Get-Date) - $arqs[-1].LastWriteTime).TotalMinutes -gt 30) { return $null }
  return $d
}
$cfgBaixada = LerPedidoBaixado 'carro-controle-config'
$pedBaixado = LerPedidoBaixado 'carro-controle-pedido'
if ($pedBaixado -and -not $UrlDados) { $pedBaixado.acao = 'buscar'; $UrlDados = $pedBaixado; $Pedido = $true }

# Busca agendada: respeita ligado/desligado, horario e intervalo (o Windows chama a cada minuto)
function ForaDaHora {
  if (-not $Ativo) { return $true }
  if ($HoraIni -and $HoraFim) {
    $h = (Get-Date).ToString('HH:mm')
    $dentro = if ($HoraIni -le $HoraFim) { $h -ge $HoraIni -and $h -le $HoraFim } else { $h -ge $HoraIni -or $h -le $HoraFim }
    if (-not $dentro) { return $true }
  }
  if ($estadoAnt -and $estadoAnt.ultimaBusca) {
    try {
      $ult = [DateTime]::Parse([string]$estadoAnt.ultimaBusca)
      if (((Get-Date) - $ult).TotalMinutes -lt ($IntervaloMin - 5)) { return $true }
    } catch { }
  }
  return $false
}
$SoEnviar = $false
if ($Agendado -and -not $UrlDados -and -not $cfgBaixada -and $agenda -eq 'min1-v3' -and (ForaDaHora)) {   # sem o agendamento novo: roda completo uma vez para instala-lo
  # nao e hora de buscar; se ficou envio para o app pendente (sem internet antes), tenta de novo a cada 10 min
  $pendente = (Test-Path -LiteralPath $FilaEnvio) -and (Get-Item -LiteralPath $FilaEnvio).Length -gt 0 -and $ApiUrl
  $velha = -not (Test-Path -LiteralPath $TentativaEnvio) -or ((Get-Date) - (Get-Item -LiteralPath $TentativaEnvio).LastWriteTime).TotalMinutes -ge 10
  if ($pendente -and $velha) { $SoEnviar = $true } else { exit 0 }
}

# Agendamento do Windows a cada minuto, sem janela (o intervalo de verdade vem da configuracao)
# Guarda no estado.json qual agendamento esta instalado
function MarcarAgenda($chave) {
  try {
    $e = if (Test-Path -LiteralPath $EstadoArq) { [IO.File]::ReadAllText($EstadoArq) | ConvertFrom-Json } else { [pscustomobject]@{} }
    $e | Add-Member -NotePropertyName agenda -NotePropertyValue $chave -Force
    [IO.File]::WriteAllText($EstadoArq, ($e | ConvertTo-Json -Depth 5), (New-Object Text.UTF8Encoding $false))
  } catch { }
}

# IMPORTANTE: recriar a tarefa encerra a execucao dela que estiver rodando (inclusive esta).
# Por isso so e chamada no FIM do script, depois de buscar, gravar e mandar tudo,
# e marca o agendamento novo no estado ANTES (senao cada minuto tentaria de novo e morreria no meio).
function GarantirAgenda {
  # v3: tarefa por XML para rodar tambem na bateria (o padrao do Windows so roda na tomada),
  # roda a que perdeu se o note estava desligado e nao abre duas ao mesmo tempo
  $chave = 'min1-v3'
  if ($agenda -eq $chave) { return }
  try {
    MarcarAgenda $chave
    $script:agenda = $chave
    Escrever 'Trocando o agendamento do Windows (confere a cada minuto, inclusive na bateria)...'
    $ps1 = Join-Path $Pasta 'buscar-carro.ps1'
    $argPs = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$ps1`" -Agendado"
    # conhost --headless: nem pisca a janela (Windows 10 2004+ e 11)
    if ([Environment]::OSVersion.Version.Build -ge 19041 -and (Test-Path (Join-Path $env:WINDIR 'System32\conhost.exe'))) {
      $cmd = 'conhost.exe'; $args3 = "--headless powershell.exe $argPs"
    } else { $cmd = 'powershell.exe'; $args3 = $argPs }
    $esc = { param($t) [Security.SecurityElement]::Escape($t) }
    $inicio = (Get-Date).AddMinutes(1).ToString('yyyy-MM-ddTHH:mm:00')
    $usuario = [Security.Principal.WindowsIdentity]::GetCurrent().Name
    $xml = @"
<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo><Description>Busca os arquivos do Carro Controle EM80 (app)</Description></RegistrationInfo>
  <Triggers>
    <TimeTrigger><StartBoundary>$inicio</StartBoundary><Enabled>true</Enabled>
      <Repetition><Interval>PT1M</Interval><StopAtDurationEnd>false</StopAtDurationEnd></Repetition>
    </TimeTrigger>
    <LogonTrigger><Enabled>true</Enabled><UserId>$(& $esc $usuario)</UserId></LogonTrigger>
  </Triggers>
  <Principals><Principal id="Author"><UserId>$(& $esc $usuario)</UserId><LogonType>InteractiveToken</LogonType><RunLevel>LeastPrivilege</RunLevel></Principal></Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <AllowHardTerminate>true</AllowHardTerminate>
    <StartWhenAvailable>true</StartWhenAvailable>
    <RunOnlyIfNetworkAvailable>false</RunOnlyIfNetworkAvailable>
    <IdleSettings><StopOnIdleEnd>false</StopOnIdleEnd><RestartOnIdle>false</RestartOnIdle></IdleSettings>
    <AllowStartOnDemand>true</AllowStartOnDemand>
    <Enabled>true</Enabled>
    <Hidden>false</Hidden>
    <RunOnlyIfIdle>false</RunOnlyIfIdle>
    <WakeToRun>false</WakeToRun>
    <ExecutionTimeLimit>PT30M</ExecutionTimeLimit>
    <Priority>7</Priority>
  </Settings>
  <Actions Context="Author"><Exec><Command>$cmd</Command><Arguments>$(& $esc $args3)</Arguments></Exec></Actions>
</Task>
"@
    $arqXml = Join-Path $env:TEMP 'carro-controle-tarefa.xml'
    [IO.File]::WriteAllText($arqXml, $xml, [Text.Encoding]::Unicode)
    $p = Start-Process -FilePath 'schtasks.exe' -ArgumentList "/create /tn `"$NomeTarefa`" /xml `"$arqXml`" /f" -WindowStyle Hidden -Wait -PassThru
    Remove-Item -LiteralPath $arqXml -Force -ErrorAction SilentlyContinue
    if ($p.ExitCode -eq 0) { Escrever 'Agendamento do Windows trocado.' 'Green' }
    else { MarcarAgenda ''; Escrever "Nao foi possivel criar o agendamento (codigo $($p.ExitCode))." 'Yellow' }
  } catch { MarcarAgenda ''; Escrever "Nao foi possivel criar o agendamento: $($_.Exception.Message)" 'Yellow' }
}

# Link carrocontrole:// (botoes do app) -> PowerShell direto -> este script com -Url "<link>"
function GarantirProtocolo {
  try {
    $ps1 = Join-Path $Pasta 'buscar-carro.ps1'
    $cmd = "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$ps1`" -Url `"%1`""
    $k = 'HKCU:\Software\Classes\carrocontrole'
    $atual = $null
    try { $atual = (Get-Item -LiteralPath "$k\shell\open\command" -ErrorAction Stop).GetValue('') } catch { }
    if ($atual -ne $cmd) {
      New-Item -Path "$k\shell\open\command" -Force | Out-Null
      Set-Item -LiteralPath $k -Value 'URL:Carro Controle EM80'
      New-ItemProperty -LiteralPath $k -Name 'URL Protocol' -Value '' -PropertyType String -Force | Out-Null
      Set-Item -LiteralPath "$k\shell\open\command" -Value $cmd
      Escrever 'Botao "Buscar agora" do app instalado (link carrocontrole://).' 'Green'
    } elseif (-not $Silencioso) { Escrever 'Link do app (carrocontrole://) registrado.' }
  } catch { Escrever "Nao foi possivel instalar o link do app: $($_.Exception.Message)" 'Yellow' }
}

# ---------- Configuracao enviada pelo app (carrocontrole://config/?...) ----------
function SalvarConfigUrl($d) {
  $cfg = [ordered]@{}
  if (Test-Path -LiteralPath $ConfigJson) {
    try { $ant = [IO.File]::ReadAllText($ConfigJson) | ConvertFrom-Json; $ant.PSObject.Properties | ForEach-Object { $cfg[$_.Name] = $_.Value } } catch { }
  }
  $bool = { param($v) $v -eq '1' -or $v -eq 'true' }
  if ($d.ContainsKey('ativo'))         { $cfg.ativo = & $bool $d.ativo }
  if ($d.intervalo -match '^\d{1,4}$')  { $cfg.intervaloMin = [Math]::Max(15, [Math]::Min(1439, [int]$d.intervalo)) }
  if ($d.ContainsKey('horaIni') -and ($d.horaIni -eq '' -or $d.horaIni -match '^\d{2}:\d{2}$')) { $cfg.horaIni = $d.horaIni }
  if ($d.ContainsKey('horaFim') -and ($d.horaFim -eq '' -or $d.horaFim -match '^\d{2}:\d{2}$')) { $cfg.horaFim = $d.horaFim }
  if ($d.ContainsKey('origens'))       { $cfg.origens = @($d.origens -split '\|' | ForEach-Object { $_.Trim() } | Where-Object { $_ -match '^(\\\\|[A-Za-z]:\\)' }) }
  if ($d.ContainsKey('ignorar'))       { $cfg.ignorar = @($d.ignorar -split '[,;]' | ForEach-Object { $_.Trim() } | Where-Object { $_ }) }
  if ($d.dias -match '^\d{1,4}$')       { $cfg.dias = [int]$d.dias }
  if ($d.avisos -in @('sempre', 'novos', 'nunca')) { $cfg.avisos = $d.avisos }
  if ($d.ContainsKey('avisarSemCabo')) { $cfg.avisarSemCabo = & $bool $d.avisarSemCabo }
  if ($d.segundosAviso -match '^\d{1,3}$') { $cfg.segundosAviso = [Math]::Max(5, [int]$d.segundosAviso) }
  if ($d.modoWifi -in @('desconectar', 'desativar')) { $cfg.modoWifi = $d.modoWifi }
  if ($d.ContainsKey('atualizarAuto')) { $cfg.atualizarAuto = & $bool $d.atualizarAuto }
  if ($d.apiUrl -match '^https://[^\s"]+$') { $cfg.apiUrl = $d.apiUrl; $script:ApiUrl = $d.apiUrl }
  if ($d.apiToken -match '^[A-Za-z0-9_-]{4,128}$') { $cfg.apiToken = $d.apiToken; $script:ApiToken = $d.apiToken }
  $cfg.salvoId = [string]$d.id
  $cfg.salvoEm = (Get-Date).ToString("yyyy-MM-dd'T'HH:mm:ssK")
  [IO.File]::WriteAllText($ConfigJson, ($cfg | ConvertTo-Json -Depth 4), (New-Object Text.UTF8Encoding $false))
  Escrever "Configuracao salva pelo app (intervalo $($cfg.intervaloMin) min)." 'Green'
  if ($null -ne $cfg.ativo) { $script:Ativo = [bool]$cfg.ativo }
  if ($cfg.intervaloMin) { $script:IntervaloMin = [int]$cfg.intervaloMin }
  if ($estadoAnt) {
    try {
      $estadoAnt | Add-Member -NotePropertyName agenda -NotePropertyValue $agenda -Force
      [IO.File]::WriteAllText($EstadoArq, ($estadoAnt | ConvertTo-Json -Depth 5), (New-Object Text.UTF8Encoding $false))
    } catch { }
  }
}
if ($UrlDados -and $UrlDados.acao -eq 'config') { SalvarConfigUrl $UrlDados; exit 0 }

function GravarEstadoConfig {
  try {
    if (-not $estadoAnt) { return }
    $cfgAtual = [IO.File]::ReadAllText($ConfigJson) | ConvertFrom-Json
    $cfgAtual.PSObject.Properties.Remove('apiToken')   # o codigo de acesso nao vai para o estado
    $estadoAnt | Add-Member -NotePropertyName config -NotePropertyValue $cfgAtual -Force
    $estadoAnt | Add-Member -NotePropertyName agenda -NotePropertyValue $agenda -Force
    [IO.File]::WriteAllText($EstadoArq, ($estadoAnt | ConvertTo-Json -Depth 5), (New-Object Text.UTF8Encoding $false))
  } catch { }
}

# ---------- Envio para o app (servidor do app -> pasta "Carro Controle EM80" no Google Drive) ----------
function Api($acao, $dados) {
  $corpo = [ordered]@{ acao = $acao; dados = $dados; token = $ApiToken } | ConvertTo-Json -Depth 6 -Compress
  $r = Invoke-RestMethod -Uri $ApiUrl -Method Post -Body ([Text.Encoding]::UTF8.GetBytes($corpo)) -ContentType 'text/plain; charset=utf-8' -TimeoutSec 180 -UseBasicParsing
  if (-not $r -or -not $r.ok) { throw "servidor: $(if ($r) { $r.erro } else { 'sem resposta' })" }
  return $r.dados
}

function Sincronizar {
  if (-not $ApiUrl -or -not $ApiToken) {
    Escrever 'Envio para o app (Google Drive) desligado: falta o endereco do servidor. No app, clique em Salvar configuracao.' 'Yellow'
    return
  }
  try { [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12 } catch { }
  try { Set-Content -LiteralPath $TentativaEnvio -Value (Get-Date).ToString('o') -ErrorAction Stop } catch { }
  # primeira vez: manda tambem os arquivos que ja estavam copiados (ultimos 30 dias)
  $marca = Join-Path $Destino 'envio-inicial.txt'
  if (-not (Test-Path -LiteralPath $marca)) {
    $limite = (Get-Date).AddDays(-30)
    $iniciais = @(Get-ChildItem -LiteralPath $Todos -File -Filter '*.csv' -ErrorAction SilentlyContinue | Where-Object { $_.LastWriteTime -ge $limite } | ForEach-Object { $_.Name })
    if ($iniciais.Count) { Add-Content -LiteralPath $FilaEnvio -Value $iniciais -Encoding UTF8 }
    try { Set-Content -LiteralPath $marca -Value (Get-Date).ToString('o') } catch { }
  }
  # a internet pode demorar a voltar depois de religar o Wi-Fi
  $online = $false
  for ($i = 0; $i -lt 12; $i++) { try { Api 'carroPing' @{} | Out-Null; $online = $true; break } catch { $ultimoErro = $_.Exception.Message; Start-Sleep -Seconds 5 } }
  if (-not $online) {
    Escrever "Sem conexao com o servidor do app ($ultimoErro); manda depois. Se o erro fala em 'Acao desconhecida', falta implantar a nova versao do Apps Script." 'Yellow'
    return
  }
  $fila = @()
  if (Test-Path -LiteralPath $FilaEnvio) { $fila = @(Get-Content -LiteralPath $FilaEnvio -Encoding UTF8 | Where-Object { $_ } | Select-Object -Unique) }
  $resta = New-Object System.Collections.ArrayList
  $enviados = 0
  foreach ($n in $fila) {
    $arq = Join-Path $Todos $n
    if (-not (Test-Path -LiteralPath $arq)) { continue }   # apagado: nao manda
    try {
      # compacta (gzip): um CSV de ~70 MB vira ~13 MB (o servidor aceita ate ~48 MB por envio)
      $bytes = [IO.File]::ReadAllBytes($arq)
      $ms = New-Object IO.MemoryStream
      $gz = New-Object IO.Compression.GZipStream($ms, [IO.Compression.CompressionMode]::Compress)
      $gz.Write($bytes, 0, $bytes.Length); $gz.Close()
      $b64 = [Convert]::ToBase64String($ms.ToArray())
      $bytes = $null; $ms = $null
      if ($b64.Length -gt 46MB) { Escrever "  Grande demais para o app mesmo compactado: $n" 'Yellow'; $b64 = $null; continue }
      Api 'carroEnviar' @{ tipo = 'arquivo'; nome = $n; gzip = '1'; base64 = $b64 } | Out-Null
      $b64 = $null
      $enviados++
    } catch { [void]$resta.Add($n); Escrever "  Nao foi para o app: $n ($($_.Exception.Message))" 'Yellow' }
  }
  try { [IO.File]::WriteAllLines($FilaEnvio, [string[]]$resta, (New-Object Text.UTF8Encoding $false)) } catch { }
  try {
    if (Test-Path -LiteralPath $EstadoArq) { Api 'carroEnviar' @{ tipo = 'estado'; conteudo = ([IO.File]::ReadAllText($EstadoArq).TrimStart([char]0xFEFF)) } | Out-Null }
    $hist = Join-Path $Destino 'historico.jsonl'
    if (Test-Path -LiteralPath $hist) {
      $ult = @([IO.File]::ReadAllLines($hist) | Select-Object -Last 300)
      Api 'carroEnviar' @{ tipo = 'historico'; conteudo = (($ult -join "`n") + "`n") } | Out-Null
    }
    if (Test-Path -LiteralPath $Log) {
      $ultLog = @([IO.File]::ReadAllLines($Log) | Select-Object -Last 300)
      Api 'carroEnviar' @{ tipo = 'log'; conteudo = (($ultLog -join "`n") + "`n") } | Out-Null
    }
    $cat = Join-Path $Destino 'catalogo.json'
    $marcaCat = Join-Path $Destino 'catalogo-enviado.txt'
    if (Test-Path -LiteralPath $cat) {
      $hash = (Get-FileHash -LiteralPath $cat -Algorithm MD5).Hash
      $antes = if (Test-Path -LiteralPath $marcaCat) { (Get-Content -LiteralPath $marcaCat -Raw).Trim() } else { '' }
      if ($hash -ne $antes) {
        Api 'carroEnviar' @{ tipo = 'catalogo'; conteudo = ([IO.File]::ReadAllText($cat).TrimStart([char]0xFEFF)) } | Out-Null
        Set-Content -LiteralPath $marcaCat -Value $hash
      }
    }
    Escrever ("Enviado ao app (Google Drive): resultado da busca" + $(if ($enviados) { " e $enviados arquivo(s)" } else { '' }) + $(if ($resta.Count) { "; $($resta.Count) ficaram para depois" } else { '' }) + '.') 'Green'
  } catch { Escrever "Erro ao mandar para o app: $($_.Exception.Message)" 'Yellow' }
}

# configuracao baixada pelo app: aplica (e, se nao houver pedido de busca junto, termina aqui)
if ($cfgBaixada) {
  SalvarConfigUrl $cfgBaixada
  if (-not $UrlDados) { GravarEstadoConfig; Sincronizar; GarantirAgenda; exit 0 }
}
if ($SoEnviar) { Sincronizar; exit 0 }

# ---------- Atualizacao automatica pelo GitHub (com internet, antes de mexer no Wi-Fi) ----------
function Atualizar {
  $arquivos = @('buscar-carro.ps1', 'Buscar arquivos do carro.bat', 'Ativar agendamento.bat', 'Remover agendamento.bat', 'LEIA-ME.txt')
  $mudou = @()
  try { [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12 } catch { }
  $tmp = Join-Path $env:TEMP 'carro-controle-atualizacao'
  New-Item -ItemType Directory -Force -Path $tmp | Out-Null
  foreach ($a in $arquivos) {
    try {
      $novo = Join-Path $tmp $a
      Invoke-WebRequest -Uri ($UrlBase + [Uri]::EscapeDataString($a)) -OutFile $novo -UseBasicParsing -TimeoutSec 20
      if ($a -eq 'buscar-carro.ps1' -and -not (Select-String -LiteralPath $novo -SimpleMatch 'CARRO-CONTROLE-EM80-SCRIPT' -Quiet)) { continue }
      $atual = Join-Path $Pasta $a
      if ((Test-Path -LiteralPath $atual) -and ((Get-FileHash -LiteralPath $atual).Hash -eq (Get-FileHash -LiteralPath $novo).Hash)) { continue }
      Copy-Item -LiteralPath $novo -Destination $atual -Force
      $mudou += $a
    } catch { }
  }
  return $mudou
}

if ($AtualizarAuto -and -not $SemAtualizar) {
  $mudou = @(Atualizar)
  if ($mudou.Count -gt 0) {
    Escrever ("Atualizado pelo GitHub: " + ($mudou -join ', ')) 'Cyan'
    if ($mudou -contains 'buscar-carro.ps1') {
      # roda a versao nova agora
      $args2 = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', (Join-Path $Pasta 'buscar-carro.ps1'), '-SemAtualizar')
      if ($Agendado) { $args2 += '-Agendado' }
      if ($Url) { $args2 += @('-Url', $Url) } elseif ($Pedido) { $args2 += '-Pedido' }
      & powershell.exe @args2
      exit $LASTEXITCODE
    }
  }
}

# Pedido do app (aba "Buscar do carro"): periodo, sedes e modo
$PedidoArq = Join-Path $Destino 'pedido.json'
$ped = $null
if ($UrlDados -and $UrlDados.acao -eq 'buscar') {
  $ped = [pscustomobject]@{
    id    = [string]$UrlDados.id
    de    = $(if ($UrlDados.de -match '^\d{4}-\d{2}-\d{2}$') { $UrlDados.de } else { '' })
    ate   = $(if ($UrlDados.ate -match '^\d{4}-\d{2}-\d{2}$') { $UrlDados.ate } else { '' })
    sedes = @(([string]$UrlDados.sedes) -split '[,; ]' | Where-Object { $_ -match '^[A-Za-z0-9]+$' })
    modo  = $(if ($UrlDados.modo -eq 'todos') { 'todos' } else { 'novos' })
  }
  $pedidoId = $ped.id
} elseif ($Pedido -and (Test-Path -LiteralPath $PedidoArq)) {
  try { $ped = [IO.File]::ReadAllText($PedidoArq) | ConvertFrom-Json; $pedidoId = [string]$ped.id } catch { }
  Remove-Item -LiteralPath $PedidoArq -Force -ErrorAction SilentlyContinue
}
$pedSedes = @()
if ($ped) { $pedSedes = @($ped.sedes | Where-Object { $_ } | ForEach-Object { ([string]$_).ToUpper() }) }

$Origens = @($Origens | Where-Object { $_ -and "$_".Trim() })
if ($Origens.Count -eq 0) {
  Escrever 'Nenhuma pasta do carro configurada: edite configuracao.ps1 (lembre das aspas simples).' 'Red'
  GravarEstado 'semPasta' -mensagem 'Nenhuma pasta do carro configurada.'
  Avisar 'Nenhuma pasta do carro configurada. Configure no app (Montagem > Arquivos do carro) ou no configuracao.ps1.' 48
  Sincronizar
  GarantirAgenda
  Fim 1
}

function CaboConectado {
  try {
    $cabo = Get-NetAdapter -Physical -ErrorAction Stop | Where-Object { $_.Status -eq 'Up' -and $_.MediaType -eq '802.3' }
    return [bool]$cabo
  } catch { return $true }   # sem como verificar: tenta assim mesmo
}

function RedeWifiAtual {
  $txt = netsh wlan show interfaces 2>$null
  foreach ($l in $txt) {
    if ($l -match '^\s*SSID\s*:\s*(.+)$') { return $Matches[1].Trim() }
  }
  return $null
}

function DesligarWifi {
  if ($ModoWifi -eq 'desativar') {
    netsh interface set interface name="$NomeAdaptador" admin=disabled | Out-Null
    Escrever "Wi-Fi desativado (adaptador $NomeAdaptador)."
  } else {
    netsh wlan disconnect | Out-Null
    Escrever 'Wi-Fi desconectado.'
  }
}

function LigarWifi($ssid) {
  if ($ModoWifi -eq 'desativar') {
    netsh interface set interface name="$NomeAdaptador" admin=enabled | Out-Null
    Escrever 'Wi-Fi reativado.' 'Green'
  }
  if ($ssid) {
    Start-Sleep -Seconds 2
    netsh wlan connect name="$ssid" | Out-Null
    Escrever "Wi-Fi reconectado em '$ssid'." 'Green'
  } else {
    Escrever 'Nao havia rede Wi-Fi conectada antes; Wi-Fi nao foi reconectado.' 'Yellow'
  }
}

function EsperarPasta($p, $seg) {
  for ($i = 0; $i -lt $seg; $i += 2) {
    if (Test-Path -LiteralPath $p) { return $true }
    Start-Sleep -Seconds 2
  }
  return $false
}

# RLT_CP_20261117... -> ramal, sede, data (AAAA-MM-DD); sem esse padrao: data de modificacao
function InfoNome($f) {
  $r = @{ ramal = ''; sede = ''; data = $f.LastWriteTime.ToString('yyyy-MM-dd') }
  if ($f.BaseName -match '^([A-Za-z0-9]+)_([A-Za-z0-9]+)_(\d{4})(\d{2})(\d{2})') {
    $r.ramal = $Matches[1].ToUpper(); $r.sede = $Matches[2].ToUpper(); $r.data = '{0}-{1}-{2}' -f $Matches[3], $Matches[4], $Matches[5]
  }
  return $r
}

function EhTeste($nome) {
  foreach ($t in $Ignorar) { if ($t -and $nome -like "*$t*") { return $true } }
  return $false
}

Escrever ("=== Buscar arquivos do Carro Controle (versao $Versao) ===" + $(if ($Agendado) { ' (agendado)' } elseif ($Pedido) { ' (pedido do app)' } else { '' })) 'Cyan'
if ($ped) { Escrever ("Pedido do app: {0} a {1}, sede(s) {2}, {3}" -f $ped.de, $ped.ate, $(if ($pedSedes.Count) { $pedSedes -join ', ' } else { 'todas' }), $ped.modo) }
Escrever "Pasta dos arquivos: $Destino"
if ($erroConfig) { Escrever "configuracao.json com erro (usando o padrao): $erroConfig" 'Yellow' }
if ($ExigirCabo -and -not (CaboConectado)) {
  Escrever 'Cabo de rede do carro nao conectado: nada foi feito.' 'Yellow'
  GravarEstado 'semCabo' -mensagem 'Cabo de rede do carro nao conectado.'
  if (($UrlDados -and $UrlDados.acao -eq 'buscar') -or ($AvisarSemCabo -and -not $Pedido -and (-not $Agendado -or $Avisos -ne 'nunca'))) { Avisar 'Busca de arquivos do carro: cabo de rede nao conectado. Nada foi feito.' 48 }
  Sincronizar
  GarantirAgenda
  Fim 0
}

# Arquivos ja copiados: caminho|tamanho|data
$copiados = @{}
if (Test-Path $Indice) { Get-Content $Indice -Encoding UTF8 | ForEach-Object { $copiados[$_] = $true } }

$ssid = RedeWifiAtual
if ($ssid) { Escrever "Wi-Fi atual: $ssid" }

$total = 0
$testes = 0
$semAcesso = @()
$falhas = 0
$catalogo = New-Object System.Collections.ArrayList
$acessou = $false
try {
  DesligarWifi
  foreach ($origem in $Origens) {
    Escrever "Acessando $origem ..."
    if (-not (EsperarPasta $origem $EsperaRede)) {
      Escrever "  Nao consegui acessar $origem (cabo conectado? computador do carro ligado?)" 'Red'
      $semAcesso += $origem
      continue
    }
    $lista = @(Get-ChildItem -LiteralPath $origem -Recurse -File -Filter $Filtro -ErrorAction SilentlyContinue)
    $acessou = $true
    $limite = (Get-Date).AddDays(-$Dias)
    $n = 0
    foreach ($f in $lista) {
      $info = InfoNome $f
      $teste = EhTeste $f.Name
      [void]$catalogo.Add([ordered]@{ nome = $f.Name; sede = $info.sede; ramal = $info.ramal; data = $info.data; tamanho = $f.Length
        modificado = $f.LastWriteTime.ToString("yyyy-MM-dd'T'HH:mm:ssK"); origem = $origem; teste = $teste })
      $chave = '{0}|{1}|{2:yyyyMMddHHmmss}' -f $f.FullName, $f.Length, $f.LastWriteTime
      $ja = $copiados.ContainsKey($chave)
      if ($ped) {
        if ($ped.de -and $info.data -lt [string]$ped.de) { continue }
        if ($ped.ate -and $info.data -gt [string]$ped.ate) { continue }
        if ($pedSedes.Count -gt 0 -and $pedSedes -notcontains $info.sede) { continue }
        if ($ja -and $ped.modo -ne 'todos') { continue }
      } else {
        if ($Dias -gt 0 -and $f.LastWriteTime -lt $limite) { continue }
        if ($ja) { continue }
      }
      if ($teste) {
        if (-not $ja) { Add-Content -Path $Indice -Value $chave -Encoding UTF8; $copiados[$chave] = $true }   # nao avisa de novo
        $testes++
        Escrever "  - desprezado (teste): $($f.Name)"
        continue
      }
      try {
        Copy-Item -LiteralPath $f.FullName -Destination (Join-Path $Todos $f.Name) -Force
        if (-not $ja) {
          $alvo = Join-Path $Novos $f.Name
          $k = 2
          while (Test-Path -LiteralPath $alvo) { $alvo = Join-Path $Novos ('{0} ({1}){2}' -f $f.BaseName, $k, $f.Extension); $k++ }
          Copy-Item -LiteralPath $f.FullName -Destination $alvo
          Add-Content -Path $Indice -Value $chave -Encoding UTF8
          $copiados[$chave] = $true
        }
        $n++
        [void]$copiadosAgora.Add($f.Name)
        Escrever "  + $($f.Name)"
      } catch {
        Escrever "  Erro ao copiar $($f.Name): $($_.Exception.Message)" 'Red'
        $falhas++
      }
    }
    Escrever "  $n arquivo(s) novo(s) em $origem" 'Green'
    $total += $n
  }
} finally {
  LigarWifi $ssid   # sempre reconecta, mesmo se der erro
}

# Lista de tudo que esta no carro (o app filtra por data e sede)
if ($acessou) {
  try {
    $cat = [ordered]@{ geradoEm = (Get-Date).ToString("yyyy-MM-dd'T'HH:mm:ssK"); origens = @($Origens); arquivos = $catalogo }
    [IO.File]::WriteAllText((Join-Path $Destino 'catalogo.json'), ($cat | ConvertTo-Json -Depth 4 -Compress), (New-Object Text.UTF8Encoding $false))
  } catch { Escrever "Nao foi possivel gravar a lista do carro: $($_.Exception.Message)" 'Yellow' }
}

$hora = Get-Date -Format 'dd/MM HH:mm'
$pendentes = @(Get-ChildItem -LiteralPath $Novos -File -ErrorAction SilentlyContinue).Count
if ($total -gt 0) {
  $msg = "$hora - $total arquivo(s) novo(s) do carro.`nEstao na pasta Novos ($pendentes no total aguardando carregar no app)."
  Escrever "Pronto: $total arquivo(s) novo(s) em $Novos" 'Green'
} else {
  $msg = "$hora - Nao existe arquivo novo do carro."
  Escrever 'Nenhum arquivo novo.' 'Yellow'
}
if ($testes -gt 0) { $msg += "`n$testes arquivo(s) de teste desprezado(s)." }
if ($semAcesso.Count -gt 0) { $msg += "`nSem acesso a: " + ($semAcesso -join ', ') }
if ($falhas -gt 0) { $msg += "`n$falhas erro(s) ao copiar; veja o log.txt." }
$icone = if ($semAcesso.Count -gt 0 -or $falhas -gt 0) { 48 } else { 64 }
$resultado = if ($semAcesso.Count -gt 0) { 'semAcesso' } else { 'ok' }
GravarEstado $resultado $total $testes $falhas $semAcesso ($msg -replace "`n", ' ')
$doApp = [bool]($UrlDados -and $UrlDados.acao -eq 'buscar')   # pedido pelo botao do app: sempre avisa o resultado
$mostrar = $doApp -or ((-not $Pedido) -and ((-not $Agendado) -or $Avisos -eq 'sempre' -or ($Avisos -eq 'novos' -and ($total -gt 0 -or $icone -eq 48))))
if ($mostrar) { Avisar $msg $icone }
# manda o resultado e os CSV copiados para o app (o Wi-Fi ja voltou)
if ($copiadosAgora.Count) { Add-Content -LiteralPath $FilaEnvio -Value @($copiadosAgora) -Encoding UTF8 }
Sincronizar
GarantirAgenda   # por ultimo: pode encerrar esta execucao
Fim 0
