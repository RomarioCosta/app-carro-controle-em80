/*
 * Simulação mínima do Google Apps Script (planilha, propriedades, utilitários)
 * para rodar o Codigo.js real no Node durante os testes.
 * Execute os testes com TZ=America/Sao_Paulo.
 */
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

class FakeRange {
  constructor(sheet, r, c, nr, nc) {
    if (r < 1 || c < 1 || nr < 1 || nc < 1) throw new Error(`Intervalo inválido ${r},${c},${nr},${nc}`);
    if (r + nr - 1 > sheet.maxRows || c + nc - 1 > sheet.maxCols) {
      throw new Error('The coordinates of the range are outside the dimensions of the sheet.');
    }
    Object.assign(this, { sheet, r, c, nr, nc });
  }
  getValues() {
    const out = [];
    for (let i = 0; i < this.nr; i++) {
      const linha = [];
      for (let j = 0; j < this.nc; j++) {
        const v = this.sheet.celula(this.r + i, this.c + j);
        linha.push(v); // datas criadas no contexto do servidor são devolvidas como estão
      }
      out.push(linha);
    }
    return out;
  }
  setValues(vals) {
    if (vals.length !== this.nr || vals.some((l) => l.length !== this.nc)) {
      throw new Error(`Dimensões incorretas: esperado ${this.nr}x${this.nc}`);
    }
    vals.forEach((l, i) => l.forEach((v, j) => this.sheet.definir(this.r + i, this.c + j, v)));
    return this;
  }
  setValue(v) { this.sheet.definir(this.r, this.c, v); return this; }
  clearContent() {
    for (let i = 0; i < this.nr; i++) for (let j = 0; j < this.nc; j++) this.sheet.definir(this.r + i, this.c + j, '');
    return this;
  }
  setNumberFormat() { return this; }
  setFontWeight() { return this; }
}

class FakeSheet {
  constructor(nome) {
    this.nome = nome;
    this.linhas = []; // matriz esparsa (índice 0 = linha 1)
    this.maxRows = 1000;
    this.maxCols = 26;
  }
  getName() { return this.nome; }
  celula(r, c) {
    const l = this.linhas[r - 1];
    const v = l ? l[c - 1] : undefined;
    return v === undefined || v === null ? '' : v;
  }
  definir(r, c, v) {
    if (typeof v === 'string' && v.startsWith('=')) throw new Error(`Fórmula gravada sem querer: ${v}`);
    if (typeof v === 'string' && v.startsWith("'")) v = v.slice(1); // apóstrofo = texto literal
    if (Object.prototype.toString.call(v) === '[object Date]' && isNaN(v.getTime())) throw new Error('Data inválida gravada');
    while (this.linhas.length < r) this.linhas.push([]);
    this.linhas[r - 1][c - 1] = v;
  }
  getLastRow() {
    for (let i = this.linhas.length - 1; i >= 0; i--) {
      if ((this.linhas[i] || []).some((v) => v !== '' && v !== undefined && v !== null)) return i + 1;
    }
    return 0;
  }
  getLastColumn() {
    let max = 0;
    this.linhas.forEach((l) => (l || []).forEach((v, j) => { if (v !== '' && v !== undefined && v !== null) max = Math.max(max, j + 1); }));
    return max;
  }
  getMaxRows() { return this.maxRows; }
  getMaxColumns() { return this.maxCols; }
  getRange(r, c, nr = 1, nc = 1) { return new FakeRange(this, r, c, nr, nc); }
  insertRowsAfter(apos, n) {
    this.linhas.splice(apos, 0, ...Array.from({ length: n }, () => []));
    this.maxRows += n;
  }
  insertColumnsAfter(apos, n) { this.maxCols += n; }
  deleteRow(r) {
    this.linhas.splice(r - 1, 1);
    this.maxRows -= 1;
  }
  setFrozenRows() {}
  /** Linhas de dados como objetos {título: valor}. */
  comoObjetos() {
    const cab = (this.linhas[0] || []).map(String);
    const p = (n) => String(n).padStart(2, '0');
    const texto = (v) => {
      if (Object.prototype.toString.call(v) !== '[object Date]') return v;
      const d = `${v.getFullYear()}-${p(v.getMonth() + 1)}-${p(v.getDate())}`;
      const h = `${p(v.getHours())}:${p(v.getMinutes())}:${p(v.getSeconds())}`;
      return h === '00:00:00' ? d : `${d}T${h}`;
    };
    return this.linhas.slice(1, this.getLastRow()).map((l) => Object.fromEntries(cab.map((t, j) => [t, texto((l || [])[j] ?? '')])));
  }
}

class FakeSpreadsheet {
  constructor() {
    this.abas = [new FakeSheet('Página1')];
  }
  getId() { return 'planilha-teste'; }
  getSheetByName(n) { return this.abas.find((s) => s.nome === n) || null; }
  insertSheet(n) {
    const s = new FakeSheet(n);
    this.abas.push(s);
    return s;
  }
  getSheets() { return this.abas.slice(); }
  deleteSheet(s) { this.abas = this.abas.filter((x) => x !== s); }
  setSpreadsheetTimeZone() {}
}

function formatDate(d, tz, padrao) {
  const partes = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
  }).formatToParts(d).map((p) => [p.type, p.value]));
  return padrao
    .replace("'T'", 'T')
    .replace('yyyy', partes.year).replace('MM', partes.month).replace('dd', partes.day)
    .replace('HH', partes.hour).replace('mm', partes.minute).replace('ss', partes.second);
}

/** Carrega o Codigo.js num contexto isolado com os serviços simulados. */
/* Drive mínimo: pastas e arquivos em memória (para a pasta do Carro Controle). */
class FakeBlob {
  constructor(bytes, tipo, nome) { this.bytes = Buffer.from(bytes); this.tipo = tipo || 'application/octet-stream'; this.nome = nome || ''; }
  getBytes() { return [...this.bytes].map((b) => (b > 127 ? b - 256 : b)); }
  getDataAsString() { return this.bytes.toString('utf8'); }
  setName(n) { this.nome = n; return this; }
  getName() { return this.nome; }
}
class FakeFile {
  constructor(pasta, nome, bytes, tipo) { Object.assign(this, { pasta, nome, bytes: Buffer.from(bytes), tipo, atualizado: new Date(), lixo: false, id: randomUUID() }); }
  getName() { return this.nome; }
  getId() { return this.id; }
  getSize() { return this.bytes.length; }
  getLastUpdated() { return this.atualizado; }
  getBlob() { return new FakeBlob(this.bytes, this.tipo, this.nome); }
  setContent(t) { this.bytes = Buffer.from(String(t), 'utf8'); this.atualizado = new Date(); return this; }
  setTrashed(v) { this.lixo = !!v; return this; }
}
const iterador = (lista) => { let i = 0; return { hasNext: () => i < lista.length, next: () => lista[i++] }; };
class FakeFolder {
  constructor(drive, nome) { Object.assign(this, { drive, nome, arquivos: [], pastas: [], id: randomUUID(), lixo: false }); drive.porId.set(this.id, this); }
  getId() { return this.id; }
  getName() { return this.nome; }
  getUrl() { return `https://drive.google.com/drive/folders/${this.id}`; }
  isTrashed() { return this.lixo; }
  createFolder(nome) { const f = new FakeFolder(this.drive, nome); this.pastas.push(f); return f; }
  getFoldersByName(nome) { return iterador(this.pastas.filter((f) => f.nome === nome && !f.lixo)); }
  getFilesByName(nome) { return iterador(this.arquivos.filter((f) => f.nome === nome && !f.lixo)); }
  getFolders() { return iterador(this.pastas.filter((f) => !f.lixo)); }
  getFiles() { return iterador(this.arquivos.filter((f) => !f.lixo)); }
  createFile(a, conteudo, tipo) {
    const f = a instanceof FakeBlob ? new FakeFile(this, a.nome, a.bytes, a.tipo) : new FakeFile(this, a, Buffer.from(String(conteudo), 'utf8'), tipo || 'text/plain');
    this.arquivos.push(f);
    return f;
  }
}
class FakeDrive {
  constructor() { this.porId = new Map(); this.raiz = new FakeFolder(this, 'Meu Drive'); }
  getRootFolder() { return this.raiz; }
  createFolder(nome) { return this.raiz.createFolder(nome); }
  getFolderById(id) { const f = this.porId.get(id); if (!f) throw new Error('No item with the given ID could be found'); return f; }
}

export function carregarServidor(caminho, { emailUsuario = '' } = {}) {
  const ss = new FakeSpreadsheet();
  const props = new Map();
  const drive = new FakeDrive();
  const ctx = {
    console: { ...console, log: () => {} }, // silencia mensagens do setup()
    SpreadsheetApp: { getActiveSpreadsheet: () => ss, openById: () => ss },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (k) => (props.has(k) ? props.get(k) : null),
        setProperty: (k, v) => props.set(k, String(v))
      })
    },
    Utilities: {
      formatDate,
      getUuid: () => randomUUID(),
      base64Decode: (t) => [...Buffer.from(String(t), 'base64')].map((b) => (b > 127 ? b - 256 : b)),
      base64Encode: (bytes) => Buffer.from(bytes.map((b) => (b < 0 ? b + 256 : b))).toString('base64'),
      newBlob: (bytes, tipo, nome) => new FakeBlob(Array.isArray(bytes) ? bytes.map((b) => (b < 0 ? b + 256 : b)) : Buffer.from(String(bytes), 'utf8'), tipo, nome)
    },
    DriveApp: drive,
    LockService: { getScriptLock: () => ({ tryLock: () => true, waitLock: () => {}, releaseLock: () => {} }) },
    ContentService: {
      MimeType: { JSON: 'application/json' },
      createTextOutput: (texto) => ({ texto, setMimeType() { return this; }, getContent() { return texto; } })
    },
    HtmlService: {},
    Session: {
      getActiveUser: () => ({ getEmail: () => emailUsuario }),
      getEffectiveUser: () => ({ getEmail: () => 'dono@exemplo.com' })
    },
    Logger: { log: () => {} }
  };
  vm.createContext(ctx);
  vm.runInContext(readFileSync(caminho, 'utf8'), ctx, { filename: 'Codigo.js' });
  return { ctx, ss, props, drive };
}
