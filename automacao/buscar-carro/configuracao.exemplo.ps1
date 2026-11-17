# =====================================================================
#  Configuracao da busca de arquivos do Carro Controle EM80
#  Copie este arquivo como "configuracao.ps1" na mesma pasta e ajuste.
#  Este arquivo NAO e substituido pela atualizacao automatica.
#  Textos SEMPRE entre aspas simples.
# =====================================================================

# Pastas dos computadores do carro, uma por linha.
$Origens = @(
  '\\COMPUTADOR\C\DADOS'
)

# Opcionais (tire o # da frente para mudar o padrao)
# $Ignorar       = @('teste')      # texto no nome do arquivo que faz ele ser desprezado
# $Dias          = 10              # so arquivos dos ultimos N dias (0 = todos)
# $AvisarSemCabo = $false          # nao avisar quando o cabo do carro nao estiver ligado
# $SegundosAviso = 30              # tempo da janela de aviso
# $ModoWifi      = 'desativar'     # desliga o adaptador (precisa administrador)
# $AtualizarAuto = $false          # nao baixar versoes novas do GitHub
