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
$Versao = '2026-11-18.6'

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

# Busca agendada: respeita ligado/desligado, horario e intervalo (o Windows chama a cada 15 min)
if ($Agendado) {
  if (-not $Ativo) { exit 0 }
  if ($HoraIni -and $HoraFim) {
    $h = (Get-Date).ToString('HH:mm')
    $dentro = if ($HoraIni -le $HoraFim) { $h -ge $HoraIni -and $h -le $HoraFim } else { $h -ge $HoraIni -or $h -le $HoraFim }
    if (-not $dentro) { exit 0 }
  }
  if ($estadoAnt -and $estadoAnt.ultimaBusca) {
    try {
      $ult = [DateTime]::Parse([string]$estadoAnt.ultimaBusca)
      if (((Get-Date) - $ult).TotalMinutes -lt ($IntervaloMin - 5)) { exit 0 }
    } catch { }
  }
}

# Agendamento do Windows a cada 15 min (cria ou troca o antigo de 2 h)
function GarantirAgenda {
  if (-not $Ativo) { return }
  $mo = [Math]::Max(15, [Math]::Min(1439, [int]$IntervaloMin))
  $chave = "ps-$mo"
  if ($agenda -eq $chave) { return }
  try {
    $ps1 = Join-Path $Pasta 'buscar-carro.ps1'
    $tr = "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File \`"$ps1\`" -Agendado"
    $argumentos = "/create /tn `"$NomeTarefa`" /sc MINUTE /mo $mo /f /tr `"$tr`""
    $p = Start-Process -FilePath 'schtasks.exe' -ArgumentList $argumentos -WindowStyle Hidden -Wait -PassThru
    if ($p.ExitCode -eq 0) { $script:agenda = $chave; Escrever "Agendamento do Windows: a cada $mo min." 'Green' }
    else { Escrever "Nao foi possivel criar o agendamento (codigo $($p.ExitCode))." 'Yellow' }
  } catch { Escrever "Nao foi possivel criar o agendamento: $($_.Exception.Message)" 'Yellow' }
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
    }
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
  $cfg.salvoId = [string]$d.id
  $cfg.salvoEm = (Get-Date).ToString("yyyy-MM-dd'T'HH:mm:ssK")
  [IO.File]::WriteAllText($ConfigJson, ($cfg | ConvertTo-Json -Depth 4), (New-Object Text.UTF8Encoding $false))
  Escrever "Configuracao salva pelo app (intervalo $($cfg.intervaloMin) min)." 'Green'
  if ($null -ne $cfg.ativo) { $script:Ativo = [bool]$cfg.ativo }
  if ($cfg.intervaloMin) { $script:IntervaloMin = [int]$cfg.intervaloMin }
  GarantirAgenda
  if ($estadoAnt) {
    try {
      $estadoAnt | Add-Member -NotePropertyName agenda -NotePropertyValue $agenda -Force
      [IO.File]::WriteAllText($EstadoArq, ($estadoAnt | ConvertTo-Json -Depth 5), (New-Object Text.UTF8Encoding $false))
    } catch { }
  }
}
if ($UrlDados -and $UrlDados.acao -eq 'config') { SalvarConfigUrl $UrlDados; exit 0 }

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
GarantirAgenda
GarantirProtocolo

if ($ExigirCabo -and -not (CaboConectado)) {
  Escrever 'Cabo de rede do carro nao conectado: nada foi feito.' 'Yellow'
  GravarEstado 'semCabo' -mensagem 'Cabo de rede do carro nao conectado.'
  if (($UrlDados -and $UrlDados.acao -eq 'buscar') -or ($AvisarSemCabo -and -not $Pedido -and (-not $Agendado -or $Avisos -ne 'nunca'))) { Avisar 'Busca de arquivos do carro: cabo de rede nao conectado. Nada foi feito.' 48 }
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
Fim 0
