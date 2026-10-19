/* Utilitários gerais: datas, formatação e identificadores. Sem dependências. */
'use strict';
window.App = window.App || {};

(function (App) {
  const U = {};

  const pad = (n, l = 2) => String(n).padStart(l, '0');
  U.pad = pad;

  /* ---------- Datas (sempre no horário local do aparelho) ---------- */
  // Formatos internos: data "aaaa-mm-dd" e data/hora "aaaa-mm-ddThh:mm:ss".

  U.dataISO = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  U.dataHoraISO = (d = new Date()) =>
    `${U.dataISO(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  U.hoje = () => U.dataISO(new Date());
  U.agora = () => U.dataHoraISO(new Date());

  U.ehData = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));
  U.ehDataHora = (s) => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(String(s || ''));

  /** Converte "aaaa-mm-dd" em Date ao meio-dia (evita problemas de fuso). */
  U.parseData = (s) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || ''));
    if (!m) return null;
    const d = new Date(+m[1], +m[2] - 1, +m[3], 12, 0, 0);
    return d.getMonth() === +m[2] - 1 ? d : null; // rejeita 31/02 etc.
  };

  U.parseDataHora = (s) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/.exec(String(s || ''));
    return m ? new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0)) : null;
  };

  U.somarDias = (iso, n) => {
    const d = U.parseData(iso);
    d.setDate(d.getDate() + n);
    return U.dataISO(d);
  };

  /** Segunda-feira da semana vigente (sábado e domingo pertencem à semana iniciada na segunda anterior). */
  U.inicioSemana = (iso) => {
    const d = U.parseData(iso);
    const dia = d.getDay(); // 0 = domingo
    d.setDate(d.getDate() + (dia === 0 ? -6 : 1 - dia));
    return U.dataISO(d);
  };

  U.inicioMes = (iso) => `${iso.slice(0, 7)}-01`;
  U.fimMes = (iso) => {
    const d = U.parseData(U.inicioMes(iso));
    d.setMonth(d.getMonth() + 1, 0);
    return U.dataISO(d);
  };

  U.diaSemanaCurto = (iso) => ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'][U.parseData(iso).getDay()];
  U.ehFimDeSemana = (iso) => {
    const d = U.parseData(iso).getDay();
    return d === 0 || d === 6;
  };

  U.fmtData = (iso) => (U.ehData(String(iso).slice(0, 10)) ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '');
  U.fmtHora = (iso) => (U.ehDataHora(iso) ? iso.slice(11, 16) : '');
  U.fmtDataHora = (iso) => (U.ehDataHora(iso) ? `${U.fmtData(iso)} ${U.fmtHora(iso)}` : '');
  U.fmtMesAno = (iso) => {
    const meses = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto',
      'setembro', 'outubro', 'novembro', 'dezembro'];
    return `${meses[+iso.slice(5, 7) - 1]} de ${iso.slice(0, 4)}`;
  };

  /** Valor para <input type="datetime-local"> (sem segundos). */
  U.paraInputDataHora = (iso) => (U.ehDataHora(iso) ? iso.slice(0, 16) : '');
  U.deInputDataHora = (v) => (v && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(v) ? `${v}:00` : (U.ehDataHora(v) ? v : ''));

  U.minutosEntre = (a, b) => {
    const da = U.parseDataHora(a);
    const db = U.parseDataHora(b);
    return da && db ? Math.round((db - da) / 60000) : null;
  };

  U.fmtDuracao = (min) => {
    if (min === null || min === undefined || min < 0) return '';
    const h = Math.floor(min / 60);
    const m = min % 60;
    return h ? `${h}h ${pad(m)}min` : `${m}min`;
  };

  /* ---------- Textos e números ---------- */

  U.normalizar = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
  U.chaveTitulo = (s) => U.normalizar(s).replace(/[^a-z0-9]/g, '');

  /** Converte texto numérico com vírgula ou ponto. Retorna null se inválido. */
  U.numero = (s) => {
    const t = String(s ?? '').trim().replace(/\s/g, '').replace(',', '.');
    if (t === '' || !/^[-+]?\d*\.?\d+$/.test(t)) return null;
    return Number(t);
  };

  /**
   * Formata quilometragem no padrão 000+000.
   * Aceita "109440", "109+440", "109.440", "109,44", "0+3".
   */
  U.formatarKm = (s) => {
    const t = String(s ?? '').trim();
    if (!t) return '';
    let km;
    let m;
    const sep = /^(\d+)\s*([+.,])\s*(\d+)$/.exec(t);
    if (sep) {
      km = sep[1];
      // "0+3" => metros (000+003); "109,44" => km decimal (109+440)
      m = sep[2] === '+' ? sep[3].padStart(3, '0') : sep[3].padEnd(3, '0');
      if (m.length > 3) return t.toUpperCase();
    } else if (/^\d+$/.test(t)) {
      if (t.length <= 3) {
        km = '0';
        m = t.padStart(3, '0');
      } else {
        km = t.slice(0, -3);
        m = t.slice(-3);
      }
    } else {
      return t.toUpperCase(); // formato desconhecido: mantém como digitado
    }
    return `${km.padStart(3, '0')}+${m.slice(0, 3)}`;
  };

  /** Normaliza coordenada (aceita vírgula). Retorna '' se vazio, null se inválida. */
  U.coordenada = (s, limite) => {
    const t = String(s ?? '').trim();
    if (!t) return '';
    const n = U.numero(t);
    if (n === null || Math.abs(n) > limite) return null;
    return String(n);
  };

  U.uuid = () => {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    const b = new Uint8Array(16);
    (window.crypto || {}).getRandomValues ? crypto.getRandomValues(b) : b.forEach((_, i) => { b[i] = Math.random() * 256; });
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  };

  U.debounce = (fn, ms) => {
    let t = null;
    return (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...args), ms);
    };
  };

  U.pct = (valor, total) => (total > 0 ? (valor / total) * 100 : null);
  U.fmtPct = (p) => (p === null || p === undefined ? '—' : `${Math.round(p)}%`);

  /** Mais frequentes primeiro (para sugestões). */
  U.maisFrequentes = (lista, limite) => {
    const cont = new Map();
    lista.forEach((v) => {
      const t = String(v || '').trim();
      if (t) cont.set(t, (cont.get(t) || 0) + 1);
    });
    return [...cont.entries()].sort((a, b) => b[1] - a[1]).slice(0, limite).map((e) => e[0]);
  };

  /* ---------- Preferências locais (pequenas, síncronas) ---------- */
  U.pref = {
    get(k, padrao = null) {
      try {
        const v = localStorage.getItem(`em80:${k}`);
        return v === null ? padrao : JSON.parse(v);
      } catch (e) {
        return padrao;
      }
    },
    set(k, v) {
      try {
        localStorage.setItem(`em80:${k}`, JSON.stringify(v));
      } catch (e) { /* armazenamento indisponível: ignora */ }
    },
    del(k) {
      try { localStorage.removeItem(`em80:${k}`); } catch (e) { /* ignora */ }
    }
  };

  App.U = U;
})(window.App);
