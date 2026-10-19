/**
 * App Carro Controle EM80 – Back-end (Google Apps Script)
 *
 * Responsabilidades:
 *  - Servir o app (doGet) quando usado pelo link do Apps Script.
 *  - Receber e devolver dados como API JSON (doPost / apiCall).
 *  - Gravar tudo na planilha do Google Sheets.
 *
 * Regras importantes:
 *  - Toda gravação é idempotente: o mesmo registro enviado duas vezes
 *    (ex.: reenvio após falha de rede) atualiza a mesma linha, sem duplicar.
 *  - Em conflito, vale a versão com "atualizadoEm" mais recente.
 *
 * Primeira instalação: execute a função setup() uma vez pelo editor.
 */

var APP_VERSAO = '1.1.0';
var TZ = 'America/Sao_Paulo';

/* ------------------------------------------------------------------ */
/* Estrutura das abas                                                  */
/* Cada coluna: [campo, título na planilha, tipo]                      */
/* Tipos: text | number | date (aaaa-mm-dd) | datetime (aaaa-mm-ddThh:mm:ss) */
/* ------------------------------------------------------------------ */
var SCHEMA = {
  Checklists: {
    chave: 'id',
    colunas: [
      ['id', 'ID', 'text'],
      ['data', 'Data', 'date'],
      ['ciclo', 'Ciclo', 'text'],
      ['responsavel', 'Responsável', 'text'],
      ['qtdProblemas', 'Qtd. problemas', 'number'],
      ['criadoEm', 'Criado em', 'datetime'],
      ['atualizadoEm', 'Atualizado em', 'datetime']
    ]
  },
  Checklist_Respostas: {
    chave: null,
    colunas: [
      ['checklistId', 'ID Checklist', 'text'],
      ['data', 'Data', 'date'],
      ['ciclo', 'Ciclo', 'text'],
      ['responsavel', 'Responsável', 'text'],
      ['grupo', 'Sistema', 'text'],
      ['perguntaId', 'ID Pergunta', 'text'],
      ['pergunta', 'Pergunta', 'text'],
      ['resposta', 'Resposta', 'text'],
      ['problema', 'Problema?', 'text'],
      ['descricao', 'Descrição', 'text']
    ]
  },
  Checklist_Amostras: {
    chave: null,
    colunas: [
      ['checklistId', 'ID Checklist', 'text'],
      ['data', 'Data', 'date'],
      ['ciclo', 'Ciclo', 'text'],
      ['grupo', 'Sistema', 'text'],
      ['medicaoId', 'ID Medição', 'text'],
      ['medicao', 'Medição', 'text'],
      ['amostra', 'Amostra', 'number'],
      ['valor', 'Valor', 'number'],
      ['rotulo2', 'Referência', 'text'],
      ['valor2', 'Valor referência', 'number']
    ]
  },
  Eventos: {
    chave: 'id',
    colunas: [
      ['id', 'ID', 'text'],
      ['inicio', 'Início', 'datetime'],
      ['fim', 'Fim', 'datetime'],
      ['duracaoMin', 'Duração (min)', 'number'],
      ['equipamento', 'Equipamento', 'text'],
      ['parte', 'Parte do equipamento', 'text'],
      ['observacao', 'Observação / impacto', 'text'],
      ['criadoEm', 'Criado em', 'datetime'],
      ['atualizadoEm', 'Atualizado em', 'datetime']
    ]
  },
  Anomalias: {
    chave: 'id',
    colunas: [
      ['id', 'ID', 'text'],
      ['acaoTomada', 'Ação tomada', 'text'],
      ['data', 'Data', 'date'],
      ['local', 'Local', 'text'],
      ['kmInicio', 'KM início', 'text'],
      ['kmFim', 'KM fim', 'text'],
      ['defeito', 'Defeito', 'text'],
      ['amplitude', 'Amplitude', 'text'],
      ['observacao', 'Observação', 'text'],
      ['elemento', 'Elemento', 'text'],
      ['latitude', 'Latitude', 'text'],
      ['longitude', 'Longitude', 'text'],
      ['linkMapa', 'Link do mapa', 'text'],
      ['criadoEm', 'Criado em', 'datetime'],
      ['atualizadoEm', 'Atualizado em', 'datetime']
    ]
  },
  OMs: {
    chave: 'chave',
    colunas: [
      ['chave', 'Chave', 'text'],
      ['ciclo', 'Ciclo', 'text'],
      ['nOrdem', 'Nº Ordem', 'text'],
      ['textoBreve', 'Texto breve', 'text'],
      ['denominacao', 'Denominação do loc. instalação', 'text'],
      ['localInstalacao', 'Local de instalação', 'text'],
      ['instalacao', 'Instalação', 'text'],
      ['plano', 'Plano de manutenção', 'text'],
      ['item', 'Item de manutenção', 'text'],
      ['statusUsuario', 'Status do usuário', 'text'],
      ['statusOrdem', 'Status da ordem', 'text'],
      ['dataPlanejada', 'Data planejada', 'date'],
      ['tolMin', 'Tolerância mínima', 'date'],
      ['tolMax', 'Tolerância máxima', 'date'],
      ['km', 'KM', 'number'],
      ['km2', 'KM2', 'number'],
      ['status', 'Status SAP', 'text'],
      ['dataProgramada', 'Data programada', 'date'],
      ['importadoEm', 'Importado em', 'datetime']
    ]
  },
  Execucoes: {
    chave: 'chave',
    colunas: [
      ['chave', 'Chave', 'text'],
      ['ciclo', 'Ciclo', 'text'],
      ['nOrdem', 'Nº Ordem', 'text'],
      ['status', 'Status', 'text'],
      ['dataRealizacao', 'Data/hora realização', 'datetime'],
      ['atualizadoEm', 'Atualizado em', 'datetime']
    ]
  }
};

var FORMATOS = { text: '@', number: '0.###', date: 'dd/mm/yyyy', datetime: 'dd/mm/yyyy hh:mm' };
var LIMITE_TEXTO = 5000;
var STATUS_OM = ['Realizado', 'Não realizado'];

/* ------------------------------------------------------------------ */
/* Pontos de entrada                                                   */
/* ------------------------------------------------------------------ */

/** Serve o app quando aberto pelo link do Apps Script. */
function doGet() {
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('Carro Controle EM80')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover');
}

/** API para o app hospedado fora do Apps Script (PWA). Exige código de acesso. */
function doPost(e) {
  var resposta;
  try {
    var req = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    if (!tokenValido_(req.token)) throw erro_('AUTH', 'Código de acesso inválido.');
    resposta = { ok: true, dados: executar_(req.acao, req.dados || {}) };
  } catch (err) {
    resposta = respostaErro_(err);
  }
  return ContentService.createTextOutput(JSON.stringify(resposta))
    .setMimeType(ContentService.MimeType.JSON);
}

/** API para o app servido pelo próprio Apps Script (google.script.run). */
function apiCall(req) {
  try {
    req = req || {};
    if (!tokenValido_(req.token) && !usuarioEhDono_()) {
      throw erro_('AUTH', 'Código de acesso necessário.');
    }
    return { ok: true, dados: executar_(req.acao, req.dados || {}) };
  } catch (err) {
    return respostaErro_(err);
  }
}

/* ------------------------------------------------------------------ */
/* Instalação                                                          */
/* ------------------------------------------------------------------ */

/**
 * Cria/atualiza as abas da planilha e gera o código de acesso.
 * Pode ser executada mais de uma vez sem perder dados.
 */
function setup() {
  var props = PropertiesService.getScriptProperties();
  var ss = planilha_();
  props.setProperty('SPREADSHEET_ID', ss.getId());
  ss.setSpreadsheetTimeZone(TZ);

  Object.keys(SCHEMA).forEach(function (nome) {
    prepararAba_(ss, nome);
  });
  removerAbaPadraoVazia_(ss);

  if (!props.getProperty('API_TOKEN')) {
    props.setProperty('API_TOKEN', gerarToken_());
  }
  var msg = 'Instalação concluída. Código de acesso do app: ' + props.getProperty('API_TOKEN');
  console.log(msg);
  return msg;
}

/** Mostra o código de acesso atual no registro de execução. */
function mostrarCodigoAcesso() {
  var token = PropertiesService.getScriptProperties().getProperty('API_TOKEN');
  console.log(token ? 'Código de acesso: ' + token : 'Execute setup() primeiro.');
  return token;
}

/** Gera um novo código de acesso (o antigo deixa de funcionar). */
function gerarNovoCodigoAcesso() {
  PropertiesService.getScriptProperties().setProperty('API_TOKEN', gerarToken_());
  return mostrarCodigoAcesso();
}

function prepararAba_(ss, nome) {
  var def = SCHEMA[nome];
  var sh = ss.getSheetByName(nome);
  if (!sh) sh = ss.insertSheet(nome);

  var titulos = def.colunas.map(function (c) { return c[1]; });
  var ultimaCol = sh.getLastColumn();
  var existentes = ultimaCol > 0 ? sh.getRange(1, 1, 1, ultimaCol).getValues()[0].map(String) : [];

  if (existentes.join('') === '') {
    sh.getRange(1, 1, 1, titulos.length).setValues([titulos]);
    existentes = titulos.slice();
  } else {
    // Acrescenta colunas novas no fim, sem mexer nas existentes.
    titulos.forEach(function (t) {
      if (existentes.indexOf(t) < 0) {
        existentes.push(t);
        garantirColunas_(sh, existentes.length);
        sh.getRange(1, existentes.length).setValue(t);
      }
    });
  }

  garantirColunas_(sh, existentes.length);
  sh.getRange(1, 1, 1, existentes.length).setFontWeight('bold');
  sh.setFrozenRows(1);

  var linhas = Math.max(sh.getMaxRows() - 1, 1);
  def.colunas.forEach(function (c) {
    var col = existentes.indexOf(c[1]) + 1;
    sh.getRange(2, col, linhas, 1).setNumberFormat(FORMATOS[c[2]]);
  });
}

function removerAbaPadraoVazia_(ss) {
  ['Página1', 'Planilha1', 'Sheet1', 'Página 1'].forEach(function (n) {
    var sh = ss.getSheetByName(n);
    if (sh && sh.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(sh);
  });
}

/* ------------------------------------------------------------------ */
/* Roteamento das ações                                                */
/* ------------------------------------------------------------------ */

var ACOES = {
  ping: { escrita: false, fn: function () { return { versao: APP_VERSAO, agora: agoraISO_() }; } },
  sync: { escrita: true, fn: acaoSync_ },
  getCiclos: { escrita: false, fn: acaoGetCiclos_ },
  getOMs: { escrita: false, fn: acaoGetOMs_ },
  importarOMs: { escrita: true, fn: acaoImportarOMs_ },
  getRecentes: { escrita: false, fn: acaoGetRecentes_ },
  getChecklist: { escrita: false, fn: acaoGetChecklist_ }
};

function executar_(acao, dados) {
  var def = ACOES[acao];
  if (!def) throw erro_('ACAO', 'Ação desconhecida: ' + acao);
  if (!def.escrita) return def.fn(dados);

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) throw erro_('OCUPADO', 'Servidor ocupado. Tente novamente.');
  try {
    return def.fn(dados);
  } finally {
    lock.releaseLock();
  }
}

/* ------------------------------------------------------------------ */
/* Ação: sincronização da fila do aparelho                             */
/* ------------------------------------------------------------------ */

var GRAVADORES = {
  checklist: gravarChecklist_,
  evento: gravarEvento_,
  anomalia: gravarAnomalia_,
  execucao: gravarExecucao_,
  reprogramacao: gravarReprogramacao_
};

function acaoSync_(dados) {
  var itens = Array.isArray(dados.itens) ? dados.itens : [];
  if (itens.length > 100) throw erro_('VALIDACAO', 'Envie no máximo 100 itens por vez.');
  var cache = {};
  var tabela = function (nome) {
    if (!cache[nome]) cache[nome] = new Tabela_(nome);
    return cache[nome];
  };
  var resultados = itens.map(function (item) {
    try {
      var gravar = GRAVADORES[item && item.tipo];
      if (!gravar) throw erro_('VALIDACAO', 'Tipo de registro desconhecido: ' + (item && item.tipo));
      gravar(item.dados || {}, tabela);
      return { key: item.key, ok: true };
    } catch (err) {
      return { key: item && item.key, ok: false, erro: String(err.message || err) };
    }
  });
  return { resultados: resultados };
}

function gravarChecklist_(d, tabela) {
  exigir_(d, ['id', 'data', 'ciclo', 'responsavel']);
  validarData_(d.data, 'data');
  var respostas = Array.isArray(d.respostas) ? d.respostas : [];
  var amostras = Array.isArray(d.amostras) ? d.amostras : [];

  var problemas = respostas.filter(function (r) { return r.problema === 'Sim'; }).length;
  var cabecalho = {
    id: d.id, data: d.data, ciclo: d.ciclo, responsavel: d.responsavel,
    qtdProblemas: problemas, criadoEm: d.criadoEm || agoraISO_(), atualizadoEm: d.atualizadoEm || agoraISO_()
  };
  if (!tabela('Checklists').upsert(cabecalho)) return; // versão mais nova já gravada

  var tResp = tabela('Checklist_Respostas');
  tResp.removerOnde('checklistId', d.id);
  tResp.inserirVarios(respostas.map(function (r) {
    return {
      checklistId: d.id, data: d.data, ciclo: d.ciclo, responsavel: d.responsavel,
      grupo: r.grupo, perguntaId: r.perguntaId, pergunta: r.pergunta,
      resposta: r.resposta, problema: r.problema, descricao: r.descricao
    };
  }));

  var tAm = tabela('Checklist_Amostras');
  tAm.removerOnde('checklistId', d.id);
  tAm.inserirVarios(amostras.map(function (a) {
    return {
      checklistId: d.id, data: d.data, ciclo: d.ciclo, grupo: a.grupo,
      medicaoId: a.medicaoId, medicao: a.medicao, amostra: a.amostra,
      valor: a.valor, rotulo2: a.rotulo2, valor2: a.valor2
    };
  }));
}

function gravarEvento_(d, tabela) {
  exigir_(d, ['id', 'inicio', 'equipamento']);
  validarDataHora_(d.inicio, 'início');
  if (d.fim) {
    validarDataHora_(d.fim, 'fim');
    if (d.fim < d.inicio) throw erro_('VALIDACAO', 'O fim não pode ser antes do início.');
  }
  var obj = copiar_(d, ['id', 'inicio', 'fim', 'equipamento', 'parte', 'observacao', 'criadoEm', 'atualizadoEm']);
  obj.duracaoMin = d.fim ? minutosEntre_(d.inicio, d.fim) : '';
  tabela('Eventos').upsert(obj);
}

function gravarAnomalia_(d, tabela) {
  exigir_(d, ['id', 'data']);
  validarData_(d.data, 'data');
  var obj = copiar_(d, ['id', 'acaoTomada', 'data', 'local', 'kmInicio', 'kmFim', 'defeito', 'amplitude',
    'observacao', 'elemento', 'latitude', 'longitude', 'linkMapa', 'criadoEm', 'atualizadoEm']);
  tabela('Anomalias').upsert(obj);
}

function gravarExecucao_(d, tabela) {
  exigir_(d, ['ciclo', 'nOrdem', 'status', 'atualizadoEm']);
  if (STATUS_OM.indexOf(d.status) < 0) throw erro_('VALIDACAO', 'Status inválido: ' + d.status);
  if (d.status === 'Realizado') validarDataHora_(d.dataRealizacao, 'data de realização');
  tabela('Execucoes').upsert({
    chave: chaveOM_(d.ciclo, d.nOrdem), ciclo: String(d.ciclo), nOrdem: String(d.nOrdem),
    status: d.status, dataRealizacao: d.status === 'Realizado' ? d.dataRealizacao : '',
    atualizadoEm: d.atualizadoEm
  });
}

function gravarReprogramacao_(d, tabela) {
  exigir_(d, ['ciclo', 'nOrdem', 'dataProgramada']);
  validarData_(d.dataProgramada, 'data programada');
  var ok = tabela('OMs').atualizarCampos(chaveOM_(d.ciclo, d.nOrdem), { dataProgramada: d.dataProgramada });
  if (!ok) throw erro_('VALIDACAO', 'OM ' + d.nOrdem + ' não encontrada no ciclo ' + d.ciclo + '.');
}

/* ------------------------------------------------------------------ */
/* Ações: OMs e consultas                                              */
/* ------------------------------------------------------------------ */

function acaoGetCiclos_() {
  var contagem = {};
  new Tabela_('OMs').todos().forEach(function (o) {
    contagem[o.ciclo] = (contagem[o.ciclo] || 0) + 1;
  });
  return Object.keys(contagem)
    .map(function (c) { return { ciclo: c, total: contagem[c] }; })
    .sort(function (a, b) { return compararCiclos_(b.ciclo, a.ciclo); });
}

function acaoGetOMs_(dados) {
  var ciclo = String(dados.ciclo || '').trim();
  if (!ciclo) throw erro_('VALIDACAO', 'Informe o ciclo.');
  var oms = new Tabela_('OMs').todos().filter(function (o) { return o.ciclo === ciclo; });
  var execucoes = new Tabela_('Execucoes').todos().filter(function (x) { return x.ciclo === ciclo; });
  return { ciclo: ciclo, oms: oms, execucoes: execucoes };
}

function acaoImportarOMs_(dados) {
  var ciclo = String(dados.ciclo || '').trim();
  if (!/^\d{1,4}$/.test(ciclo)) throw erro_('VALIDACAO', 'Ciclo inválido. Use apenas números.');
  var lista = Array.isArray(dados.oms) ? dados.oms : [];
  if (!lista.length) throw erro_('VALIDACAO', 'Nenhuma OM para importar.');
  if (lista.length > 5000) throw erro_('VALIDACAO', 'Arquivo grande demais (máx. 5000 OMs).');

  var agora = agoraISO_();
  var vistos = {};
  var novas = [];
  lista.forEach(function (o) {
    var n = String(o.nOrdem || '').trim();
    if (!n || vistos[n]) return;
    vistos[n] = true;
    [o.dataProgramada, o.dataPlanejada, o.tolMin, o.tolMax].forEach(function (v) {
      if (v) validarData_(v, 'data da OM ' + n);
    });
    var obj = copiar_(o, ['textoBreve', 'denominacao', 'localInstalacao', 'instalacao', 'plano', 'item',
      'statusUsuario', 'statusOrdem', 'dataPlanejada', 'tolMin', 'tolMax', 'km', 'km2', 'status', 'dataProgramada']);
    obj.chave = chaveOM_(ciclo, n);
    obj.ciclo = ciclo;
    obj.nOrdem = n;
    obj.importadoEm = agora;
    novas.push(obj);
  });

  var t = new Tabela_('OMs');
  var outras = t.todos().filter(function (o) { return o.ciclo !== ciclo; });
  t.substituirTudo(outras.concat(novas));
  return { ciclo: ciclo, importadas: novas.length };
}

function acaoGetRecentes_(dados) {
  var mapa = { evento: 'Eventos', anomalia: 'Anomalias', checklist: 'Checklists' };
  var nome = mapa[dados.tipo];
  if (!nome) throw erro_('VALIDACAO', 'Tipo inválido.');
  var limite = Math.min(Math.max(parseInt(dados.limite, 10) || 50, 1), 300);
  return new Tabela_(nome).todos()
    .sort(function (a, b) { return String(b.criadoEm).localeCompare(String(a.criadoEm)); })
    .slice(0, limite);
}

/** Checklist completo (cabeçalho, respostas e amostras), usado no laudo. */
function acaoGetChecklist_(dados) {
  var id = String(dados.id || '');
  if (!id) throw erro_('VALIDACAO', 'Informe o checklist.');
  var cab = new Tabela_('Checklists').todos().filter(function (c) { return c.id === id; })[0];
  if (!cab) throw erro_('VALIDACAO', 'Checklist não encontrado na planilha.');
  cab.respostas = new Tabela_('Checklist_Respostas').todos().filter(function (r) { return r.checklistId === id; });
  cab.amostras = new Tabela_('Checklist_Amostras').todos().filter(function (a) { return a.checklistId === id; });
  return cab;
}

/* ------------------------------------------------------------------ */
/* Acesso à planilha                                                   */
/* ------------------------------------------------------------------ */

var planilhaCache_ = null;

function planilha_() {
  if (planilhaCache_) return planilhaCache_;
  var id = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
  var ss = id ? SpreadsheetApp.openById(id) : SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw erro_('CONFIG', 'Planilha não encontrada. Execute setup() no editor do Apps Script.');
  planilhaCache_ = ss;
  return ss;
}

/**
 * Representa uma aba da planilha com leitura/gravação por objetos.
 * Localiza as colunas pelo título, então reordenar colunas não quebra nada.
 */
function Tabela_(nome) {
  this.nome = nome;
  this.def = SCHEMA[nome];
  this.sh = planilha_().getSheetByName(nome);
  if (!this.sh) throw erro_('CONFIG', 'Aba "' + nome + '" não encontrada. Execute setup().');
  this.ncol = this.sh.getLastColumn();
  var titulos = this.sh.getRange(1, 1, 1, this.ncol).getValues()[0].map(String);
  var self = this;
  this.pos = {};
  this.def.colunas.forEach(function (c) {
    var i = titulos.indexOf(c[1]);
    if (i < 0) throw erro_('CONFIG', 'Coluna "' + c[1] + '" não encontrada na aba ' + nome + '. Execute setup().');
    self.pos[c[0]] = i;
  });
  this.mapaChaves_ = null;
}

Tabela_.prototype.qtdLinhas = function () {
  return Math.max(this.sh.getLastRow() - 1, 0);
};

Tabela_.prototype.linhasBrutas_ = function () {
  var n = this.qtdLinhas();
  return n ? this.sh.getRange(2, 1, n, this.ncol).getValues() : [];
};

Tabela_.prototype.paraObjeto_ = function (linha) {
  var obj = {};
  var self = this;
  this.def.colunas.forEach(function (c) {
    obj[c[0]] = lerValor_(linha[self.pos[c[0]]], c[2]);
  });
  return obj;
};

Tabela_.prototype.paraLinha_ = function (obj, base) {
  var linha = base ? base.slice() : new Array(this.ncol).fill('');
  var self = this;
  this.def.colunas.forEach(function (c) {
    if (Object.prototype.hasOwnProperty.call(obj, c[0])) {
      linha[self.pos[c[0]]] = gravarValor_(obj[c[0]], c[2]);
    }
  });
  return linha;
};

Tabela_.prototype.todos = function () {
  var self = this;
  return this.linhasBrutas_()
    .filter(function (l) { return l.join('') !== ''; })
    .map(function (l) { return self.paraObjeto_(l); });
};

Tabela_.prototype.mapa_ = function () {
  if (this.mapaChaves_) return this.mapaChaves_;
  var mapa = {};
  var n = this.qtdLinhas();
  if (n) {
    var col = this.pos[this.def.chave] + 1;
    this.sh.getRange(2, col, n, 1).getValues().forEach(function (l, i) {
      var k = String(l[0]);
      if (k) mapa[k] = i + 2;
    });
  }
  this.mapaChaves_ = mapa;
  return mapa;
};

/**
 * Insere ou atualiza pela chave. Retorna false se a versão gravada
 * na planilha for mais recente (o registro recebido é ignorado).
 */
Tabela_.prototype.upsert = function (obj) {
  var chave = String(obj[this.def.chave] || '');
  if (!chave) throw erro_('VALIDACAO', 'Registro sem chave.');
  var linhaNum = this.mapa_()[chave];

  if (linhaNum) {
    var atual = this.sh.getRange(linhaNum, 1, 1, this.ncol).getValues()[0];
    if (this.pos.atualizadoEm !== undefined && obj.atualizadoEm) {
      var gravado = lerValor_(atual[this.pos.atualizadoEm], 'datetime');
      if (gravado && gravado > obj.atualizadoEm) return false;
    }
    if (this.pos.criadoEm !== undefined) {
      var criado = lerValor_(atual[this.pos.criadoEm], 'datetime');
      if (criado) obj.criadoEm = criado; // preserva a criação original
    }
    this.sh.getRange(linhaNum, 1, 1, this.ncol).setValues([this.paraLinha_(obj, atual)]);
    return true;
  }

  var destino = this.sh.getLastRow() + 1;
  garantirLinhas_(this.sh, destino);
  this.sh.getRange(destino, 1, 1, this.ncol).setValues([this.paraLinha_(obj)]);
  this.mapa_()[chave] = destino;
  return true;
};

/** Atualiza só alguns campos de um registro existente. */
Tabela_.prototype.atualizarCampos = function (chave, campos) {
  var linhaNum = this.mapa_()[String(chave)];
  if (!linhaNum) return false;
  var atual = this.sh.getRange(linhaNum, 1, 1, this.ncol).getValues()[0];
  this.sh.getRange(linhaNum, 1, 1, this.ncol).setValues([this.paraLinha_(campos, atual)]);
  return true;
};

Tabela_.prototype.inserirVarios = function (objs) {
  if (!objs.length) return;
  var self = this;
  var linhas = objs.map(function (o) { return self.paraLinha_(o); });
  var inicio = this.sh.getLastRow() + 1;
  garantirLinhas_(this.sh, inicio + linhas.length - 1);
  this.sh.getRange(inicio, 1, linhas.length, this.ncol).setValues(linhas);
  this.mapaChaves_ = null;
};

Tabela_.prototype.removerOnde = function (campo, valor) {
  var n = this.qtdLinhas();
  if (!n) return 0;
  var col = this.pos[campo] + 1;
  var valores = this.sh.getRange(2, col, n, 1).getValues();
  var removidas = 0;
  for (var i = valores.length - 1; i >= 0; i--) {
    if (String(valores[i][0]) === String(valor)) {
      this.sh.deleteRow(i + 2);
      removidas++;
    }
  }
  if (removidas) this.mapaChaves_ = null;
  return removidas;
};

/** Regrava todas as linhas de dados (usado na importação de OMs). */
Tabela_.prototype.substituirTudo = function (objs) {
  var n = this.qtdLinhas();
  if (n) this.sh.getRange(2, 1, n, this.ncol).clearContent();
  var self = this;
  var linhas = objs.map(function (o) { return self.paraLinha_(o); });
  if (linhas.length) {
    garantirLinhas_(this.sh, linhas.length + 1);
    this.sh.getRange(2, 1, linhas.length, this.ncol).setValues(linhas);
  }
  this.mapaChaves_ = null;
};

function garantirLinhas_(sh, ultimaLinha) {
  var max = sh.getMaxRows();
  if (ultimaLinha > max) sh.insertRowsAfter(max, ultimaLinha - max);
}

function garantirColunas_(sh, ultimaColuna) {
  var max = sh.getMaxColumns();
  if (ultimaColuna > max) sh.insertColumnsAfter(max, ultimaColuna - max);
}

/* ------------------------------------------------------------------ */
/* Conversão de valores                                                */
/* ------------------------------------------------------------------ */

function gravarValor_(v, tipo) {
  if (v === null || v === undefined) return '';
  if (tipo === 'number') {
    if (v === '') return '';
    var n = Number(String(v).replace(',', '.'));
    return isFinite(n) ? n : '';
  }
  if (tipo === 'date') {
    var d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(v));
    return d ? new Date(+d[1], +d[2] - 1, +d[3]) : '';
  }
  if (tipo === 'datetime') {
    var m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?/.exec(String(v));
    return m ? new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0)) : '';
  }
  var s = String(v);
  if (s.length > LIMITE_TEXTO) s = s.slice(0, LIMITE_TEXTO);
  // Evita que um texto iniciado por "=" seja interpretado como fórmula.
  return /^[=]/.test(s) ? "'" + s : s;
}

function lerValor_(v, tipo) {
  if (v === null || v === undefined || v === '') return '';
  if (tipo === 'date') {
    return v instanceof Date ? Utilities.formatDate(v, TZ, 'yyyy-MM-dd') : String(v);
  }
  if (tipo === 'datetime') {
    return v instanceof Date ? Utilities.formatDate(v, TZ, "yyyy-MM-dd'T'HH:mm:ss") : String(v);
  }
  if (tipo === 'number') {
    return typeof v === 'number' ? v : (isFinite(Number(v)) ? Number(v) : '');
  }
  if (v instanceof Date) return Utilities.formatDate(v, TZ, 'yyyy-MM-dd');
  return String(v);
}

/* ------------------------------------------------------------------ */
/* Utilitários                                                         */
/* ------------------------------------------------------------------ */

function erro_(codigo, mensagem) {
  var e = new Error(mensagem);
  e.codigo = codigo;
  return e;
}

function respostaErro_(err) {
  return { ok: false, codigo: (err && err.codigo) || 'ERRO', erro: String((err && err.message) || err) };
}

function tokenValido_(token) {
  var esperado = PropertiesService.getScriptProperties().getProperty('API_TOKEN');
  return !!esperado && typeof token === 'string' && token.trim() === esperado;
}

function usuarioEhDono_() {
  try {
    var ativo = Session.getActiveUser().getEmail();
    var dono = Session.getEffectiveUser().getEmail();
    return !!ativo && ativo === dono;
  } catch (e) {
    return false;
  }
}

function gerarToken_() {
  return Utilities.getUuid().replace(/-/g, '').slice(0, 12).toUpperCase();
}

function exigir_(obj, campos) {
  campos.forEach(function (c) {
    if (obj[c] === undefined || obj[c] === null || String(obj[c]).trim() === '') {
      throw erro_('VALIDACAO', 'Campo obrigatório ausente: ' + c);
    }
  });
}

function validarData_(v, nome) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(v || ''))) throw erro_('VALIDACAO', 'Data inválida (' + nome + '): ' + v);
}

function validarDataHora_(v, nome) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(String(v || ''))) {
    throw erro_('VALIDACAO', 'Data/hora inválida (' + nome + '): ' + v);
  }
}

function copiar_(origem, campos) {
  var obj = {};
  campos.forEach(function (c) {
    if (origem[c] !== undefined) obj[c] = origem[c];
  });
  return obj;
}

function chaveOM_(ciclo, nOrdem) {
  return String(ciclo).trim() + '|' + String(nOrdem).trim();
}

function compararCiclos_(a, b) {
  var na = Number(a), nb = Number(b);
  if (isFinite(na) && isFinite(nb)) return na - nb;
  return String(a).localeCompare(String(b));
}

function minutosEntre_(a, b) {
  var p = function (s) {
    var m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?/.exec(s);
    return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0));
  };
  return Math.round((p(b) - p(a)) / 60000);
}

function agoraISO_() {
  return Utilities.formatDate(new Date(), TZ, "yyyy-MM-dd'T'HH:mm:ss");
}
