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
export function carregarServidor(caminho, { emailUsuario = '' } = {}) {
  const ss = new FakeSpreadsheet();
  const props = new Map();
  const ctx = {
    console,
    SpreadsheetApp: { getActiveSpreadsheet: () => ss, openById: () => ss },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (k) => (props.has(k) ? props.get(k) : null),
        setProperty: (k, v) => props.set(k, String(v))
      })
    },
    Utilities: { formatDate, getUuid: () => randomUUID() },
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
  return { ctx, ss, props };
}
