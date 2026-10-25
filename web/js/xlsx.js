/*
 * Gerador de planilhas Excel (.xlsx) sem bibliotecas: funciona offline.
 * Monta o pacote OOXML (zip sem compressão) com planilhas, estilos, tabelas do Excel
 * (filtro e linhas zebradas, como no Ctrl+T) e gráficos nativos do Excel.
 *
 * Uso: App.xlsx.gerar({ autor, planilhas: [planilha] }) → Uint8Array; App.xlsx.baixar(bytes, nome).
 * planilha = {
 *   nome, larguras: [cm por coluna], alturas: { linha: pontos }, linhas: [[célula…]…], mesclas: ['A1:D1'],
 *   congelar: n (linhas fixas no topo), paisagem: true, grade: false (esconde as linhas de grade),
 *   tabelas: [{ ref: 'A3:F20', nome: 'tbEventos' }]  (1ª linha da ref = cabeçalho),
 *   graficos: [grafico]
 * }
 * célula = null | texto | número | { v, e: 'estilo' }  (estilos em ESTILOS; datas com App.xlsx.serial)
 * grafico = { tipo: 'barrasLinha' | 'barrasH', titulo, de: [col, lin], ate: [col, lin] (0-based),
 *   categorias: { ref, valores, formato? }, series: [{ nome, ref, valores, tipo?: 'linha', cor? }], formatoLinha? }
 */
'use strict';

(function (App) {
  /* ---------------- Zip (sem compressão) ---------------- */

  const TABELA_CRC = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();
  function crc32(bytes) {
    let c = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) c = TABELA_CRC[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }

  /** arquivos: [[caminho, texto]] → Uint8Array do zip. */
  function zip(arquivos) {
    const enc = new TextEncoder();
    const partes = []; const central = [];
    let pos = 0;
    // data/hora da geração no formato DOS
    const d = new Date();
    const dosHora = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
    const dosData = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
    arquivos.forEach(([nome, texto]) => {
      const nomeB = enc.encode(nome);
      const dados = enc.encode(texto);
      const crc = crc32(dados);
      const loc = new DataView(new ArrayBuffer(30));
      loc.setUint32(0, 0x04034b50, true); loc.setUint16(4, 20, true); loc.setUint16(6, 0x0800, true); loc.setUint16(8, 0, true);
      loc.setUint16(10, dosHora, true); loc.setUint16(12, dosData, true); loc.setUint32(14, crc, true);
      loc.setUint32(18, dados.length, true); loc.setUint32(22, dados.length, true); loc.setUint16(26, nomeB.length, true); loc.setUint16(28, 0, true);
      const cen = new DataView(new ArrayBuffer(46));
      cen.setUint32(0, 0x02014b50, true); cen.setUint16(4, 20, true); cen.setUint16(6, 20, true); cen.setUint16(8, 0x0800, true); cen.setUint16(10, 0, true);
      cen.setUint16(12, dosHora, true); cen.setUint16(14, dosData, true); cen.setUint32(16, crc, true);
      cen.setUint32(20, dados.length, true); cen.setUint32(24, dados.length, true); cen.setUint16(28, nomeB.length, true);
      cen.setUint32(42, pos, true);
      partes.push(new Uint8Array(loc.buffer), nomeB, dados);
      central.push(new Uint8Array(cen.buffer), nomeB);
      pos += 30 + nomeB.length + dados.length;
    });
    const tamCentral = central.reduce((t, p) => t + p.length, 0);
    const fim = new DataView(new ArrayBuffer(22));
    fim.setUint32(0, 0x06054b50, true); fim.setUint16(8, arquivos.length, true); fim.setUint16(10, arquivos.length, true);
    fim.setUint32(12, tamCentral, true); fim.setUint32(16, pos, true);
    const todas = [...partes, ...central, new Uint8Array(fim.buffer)];
    const out = new Uint8Array(todas.reduce((t, p) => t + p.length, 0));
    let o = 0; todas.forEach((p) => { out.set(p, o); o += p.length; });
    return out;
  }

  /* ---------------- Utilidades ---------------- */

  const esc = (v) => String(v ?? '')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const letra = (c) => { let s = ''; c += 1; while (c > 0) { const m = (c - 1) % 26; s = String.fromCharCode(65 + m) + s; c = Math.floor((c - 1) / 26); } return s; };
  const ref = (c, l) => `${letra(c)}${l + 1}`;
  const absoluta = (planilha, c0, l0, c1, l1) => `'${String(planilha).replace(/'/g, "''")}'!$${letra(c0)}$${l0 + 1}:$${letra(c1)}$${l1 + 1}`;

  /** "2026-10-19T08:30:00" ou "2026-10-19" (hora local) → número de série do Excel. */
  function serial(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2}))?)?/.exec(String(iso || ''));
    if (!m) return null;
    const dias = (Date.UTC(+m[1], +m[2] - 1, +m[3]) - Date.UTC(1899, 11, 30)) / 86400000;
    return dias + ((+m[4] || 0) * 3600 + (+m[5] || 0) * 60 + (+m[6] || 0)) / 86400;
  }

  /* ---------------- Estilos ---------------- */

  // formatos: 164 data e hora, 165 data, 166 duração, 167 decimal, 168 dia/mês
  const NUMFMTS = [[164, 'dd/mm/yyyy hh:mm'], [165, 'dd/mm/yyyy'], [166, '[h]:mm'], [167, '#,##0.0'], [168, 'dd/mm']];
  // fontes: 0 normal, 1 negrito, 2 título, 3 cinza, 4 valor do cartão, 5 rótulo do cartão
  const FONTES = [
    '<font><sz val="11"/><color theme="1"/><name val="Calibri"/><family val="2"/><scheme val="minor"/></font>',
    '<font><b/><sz val="11"/><color theme="1"/><name val="Calibri"/><family val="2"/><scheme val="minor"/></font>',
    '<font><b/><sz val="15"/><color rgb="FF1F3864"/><name val="Calibri"/><family val="2"/><scheme val="minor"/></font>',
    '<font><sz val="10"/><color rgb="FF595959"/><name val="Calibri"/><family val="2"/><scheme val="minor"/></font>',
    '<font><b/><sz val="18"/><color rgb="FF1F3864"/><name val="Calibri"/><family val="2"/><scheme val="minor"/></font>',
    '<font><sz val="9"/><color rgb="FF595959"/><name val="Calibri"/><family val="2"/><scheme val="minor"/></font>'
  ];
  // preenchimentos: 0 nenhum, 1 gray125 (obrigatório), 2 cartão
  const PREENCHIMENTOS = [
    '<fill><patternFill patternType="none"/></fill>',
    '<fill><patternFill patternType="gray125"/></fill>',
    '<fill><patternFill patternType="solid"><fgColor rgb="FFF2F2F2"/><bgColor indexed="64"/></patternFill></fill>'
  ];
  // bordas: 0 nenhuma, 1 linha embaixo (seção), 2 laterais brancas (separa os cartões)
  const BORDAS = [
    '<border><left/><right/><top/><bottom/><diagonal/></border>',
    '<border><left/><right/><top/><bottom style="medium"><color rgb="FF1F3864"/></bottom><diagonal/></border>',
    '<border><left style="thick"><color rgb="FFFFFFFF"/></left><right style="thick"><color rgb="FFFFFFFF"/></right><top/><bottom/><diagonal/></border>'
  ];
  const al = (h, v, quebra) => `<alignment${h ? ` horizontal="${h}"` : ''}${v ? ` vertical="${v}"` : ''}${quebra ? ' wrapText="1"' : ''}/>`;
  /** nome → [numFmtId, fonte, preenchimento, borda, alinhamento] */
  const ESTILOS = {
    padrao: [0, 0, 0, 0, null],
    titulo: [0, 2, 0, 0, null],
    sub: [0, 3, 0, 0, null],
    secao: [0, 1, 0, 1, null],
    cab: [0, 1, 0, 0, al(null, 'center', true)],
    texto: [0, 0, 0, 0, al(null, 'top')],
    quebra: [0, 0, 0, 0, al(null, 'top', true)],
    inteiro: [3, 0, 0, 0, al(null, 'top')],
    decimal: [167, 0, 0, 0, al(null, 'top')],
    dataHora: [164, 0, 0, 0, al('left', 'top')],
    data: [165, 0, 0, 0, al('left', 'top')],
    duracao: [166, 0, 0, 0, al(null, 'top')],
    cartaoRotulo: [0, 5, 2, 2, al('left', 'center')],
    cartaoInteiro: [3, 4, 2, 2, al('left', 'center')],
    cartaoDuracao: [166, 4, 2, 2, al('left', 'center')],
    cartaoSub: [0, 3, 2, 2, al('left', 'top', true)],
    nota: [0, 3, 0, 0, al(null, 'top', true)]
  };
  const NOMES_ESTILO = Object.keys(ESTILOS);
  const idEstilo = (nome) => Math.max(0, NOMES_ESTILO.indexOf(nome || 'padrao'));

  function estilosXml() {
    const xfs = NOMES_ESTILO.map((n) => {
      const [fmt, fonte, fill, borda, alin] = ESTILOS[n];
      const attrs = `numFmtId="${fmt}" fontId="${fonte}" fillId="${fill}" borderId="${borda}" xfId="0"`
        + `${fmt ? ' applyNumberFormat="1"' : ''}${fonte ? ' applyFont="1"' : ''}${fill ? ' applyFill="1"' : ''}${borda ? ' applyBorder="1"' : ''}${alin ? ' applyAlignment="1"' : ''}`;
      return alin ? `<xf ${attrs}>${alin}</xf>` : `<xf ${attrs}/>`;
    });
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
      + '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
      + `<numFmts count="${NUMFMTS.length}">${NUMFMTS.map(([id, f]) => `<numFmt numFmtId="${id}" formatCode="${esc(f)}"/>`).join('')}</numFmts>`
      + `<fonts count="${FONTES.length}">${FONTES.join('')}</fonts>`
      + `<fills count="${PREENCHIMENTOS.length}">${PREENCHIMENTOS.join('')}</fills>`
      + `<borders count="${BORDAS.length}">${BORDAS.join('')}</borders>`
      + '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
      + `<cellXfs count="${xfs.length}">${xfs.join('')}</cellXfs>`
      + '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>'
      + '<dxfs count="0"/><tableStyles count="0" defaultTableStyle="TableStyleMedium2" defaultPivotStyle="PivotStyleLight16"/>'
      + '</styleSheet>';
  }

  /* ---------------- Planilha ---------------- */

  function celulaXml(c, col, lin) {
    if (c === null || c === undefined || c === '') return '';
    const obj = typeof c === 'object' ? c : { v: c };
    const s = idEstilo(obj.e);
    const r = ref(col, lin);
    const v = obj.v;
    if (v === null || v === undefined || v === '') return s ? `<c r="${r}" s="${s}"/>` : '';
    if (typeof v === 'number') return Number.isFinite(v) ? `<c r="${r}" s="${s}"><v>${v}</v></c>` : '';
    return `<c r="${r}" s="${s}" t="inlineStr"><is><t xml:space="preserve">${esc(v)}</t></is></c>`;
  }

  function planilhaXml(p, relDesenho, relTabelas) {
    const linhas = p.linhas || [];
    const nCols = Math.max(1, ...linhas.map((l) => (l || []).length));
    const dim = `A1:${ref(nCols - 1, Math.max(0, linhas.length - 1))}`;
    const cols = (p.larguras || []).map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('');
    const vista = p.congelar
      ? `<sheetView workbookViewId="0"${p.grade === false ? ' showGridLines="0"' : ''}${p.selecionada ? ' tabSelected="1"' : ''}><pane ySplit="${p.congelar}" topLeftCell="A${p.congelar + 1}" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A${p.congelar + 1}" sqref="A${p.congelar + 1}"/></sheetView>`
      : `<sheetView workbookViewId="0"${p.grade === false ? ' showGridLines="0"' : ''}${p.selecionada ? ' tabSelected="1"' : ''}/>`;
    const dados = linhas.map((l, li) => {
      const cel = (l || []).map((c, ci) => celulaXml(c, ci, li)).join('');
      const alt = p.alturas && p.alturas[li] ? ` ht="${p.alturas[li]}" customHeight="1"` : '';
      return cel || alt ? `<row r="${li + 1}"${alt}>${cel}</row>` : '';
    }).join('');
    const mesclas = (p.mesclas || []).length ? `<mergeCells count="${p.mesclas.length}">${p.mesclas.map((m) => `<mergeCell ref="${m}"/>`).join('')}</mergeCells>` : '';
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
      + '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
      + `<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr><dimension ref="${dim}"/><sheetViews>${vista}</sheetViews>`
      + '<sheetFormatPr defaultRowHeight="15"/>'
      + (cols ? `<cols>${cols}</cols>` : '')
      + `<sheetData>${dados}</sheetData>${mesclas}`
      + '<pageMargins left="0.5" right="0.5" top="0.6" bottom="0.6" header="0.3" footer="0.3"/>'
      + `<pageSetup paperSize="9" orientation="${p.paisagem ? 'landscape' : 'portrait'}" fitToWidth="1" fitToHeight="0"/>`
      + (relDesenho ? `<drawing r:id="${relDesenho}"/>` : '')
      + (relTabelas.length ? `<tableParts count="${relTabelas.length}">${relTabelas.map((id) => `<tablePart r:id="${id}"/>`).join('')}</tableParts>` : '')
      + '</worksheet>';
  }

  function tabelaXml(t, id, p) {
    const m = /^([A-Z]+)(\d+):([A-Z]+)(\d+)$/.exec(t.ref);
    const col = (s) => s.split('').reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
    const c0 = col(m[1]); const c1 = col(m[3]); const l0 = Number(m[2]) - 1;
    const cab = (p.linhas[l0] || []).slice(c0, c1 + 1).map((c) => String(c && typeof c === 'object' ? c.v : c));
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
      + `<table xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" id="${id}" name="${esc(t.nome)}" displayName="${esc(t.nome)}" ref="${t.ref}" totalsRowShown="0">`
      + `<autoFilter ref="${t.ref}"/><tableColumns count="${cab.length}">${cab.map((n, i) => `<tableColumn id="${i + 1}" name="${esc(n)}"/>`).join('')}</tableColumns>`
      + `<tableStyleInfo name="${t.estilo || 'TableStyleMedium2'}" showFirstColumn="0" showLastColumn="0" showRowStripes="1" showColumnStripes="0"/></table>`;
  }

  /* ---------------- Gráficos ---------------- */

  const corSerie = (cor) => `<c:spPr><a:solidFill><a:srgbClr val="${cor}"/></a:solidFill></c:spPr>`;
  const corLinha = (cor) => `<c:spPr><a:ln w="22225" cap="rnd"><a:solidFill><a:srgbClr val="${cor}"/></a:solidFill><a:round/></a:ln></c:spPr>`;
  const textoEixo = '<c:txPr><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="900"><a:solidFill><a:srgbClr val="595959"/></a:solidFill></a:defRPr></a:pPr><a:endParaRPr lang="pt-BR"/></a:p></c:txPr>';
  const linhaGrade = '<c:majorGridlines><c:spPr><a:ln w="9525"><a:solidFill><a:srgbClr val="D9D9D9"/></a:solidFill></a:ln></c:spPr></c:majorGridlines>';
  const semLinha = '<c:spPr><a:ln><a:noFill/></a:ln></c:spPr>';
  const eixoLinha = '<c:spPr><a:ln w="9525"><a:solidFill><a:srgbClr val="BFBFBF"/></a:solidFill></a:ln></c:spPr>';

  function categoriasXml(cat) {
    const n = cat.valores.length;
    const numeros = cat.valores.every((v) => typeof v === 'number');
    if (numeros) {
      return `<c:cat><c:numRef><c:f>${esc(cat.ref)}</c:f><c:numCache><c:formatCode>${esc(cat.formato || 'General')}</c:formatCode><c:ptCount val="${n}"/>`
        + `${cat.valores.map((v, i) => `<c:pt idx="${i}"><c:v>${v}</c:v></c:pt>`).join('')}</c:numCache></c:numRef></c:cat>`;
    }
    return `<c:cat><c:strRef><c:f>${esc(cat.ref)}</c:f><c:strCache><c:ptCount val="${n}"/>`
      + `${cat.valores.map((v, i) => `<c:pt idx="${i}"><c:v>${esc(v)}</c:v></c:pt>`).join('')}</c:strCache></c:strRef></c:cat>`;
  }
  function valoresXml(s, formato = 'General') {
    return `<c:val><c:numRef><c:f>${esc(s.ref)}</c:f><c:numCache><c:formatCode>${esc(formato)}</c:formatCode><c:ptCount val="${s.valores.length}"/>`
      + `${s.valores.map((v, i) => (Number.isFinite(v) ? `<c:pt idx="${i}"><c:v>${v}</c:v></c:pt>` : '')).join('')}</c:numCache></c:numRef></c:val>`;
  }
  const nomeSerie = (s) => `<c:tx><c:strRef><c:f>${esc(s.refNome)}</c:f><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>${esc(s.nome)}</c:v></c:pt></c:strCache></c:strRef></c:tx>`;

  function eixoCat(id, cruza, { posicao = 'b', apagar = false, inverter = false, formato = null } = {}) {
    return `<c:catAx><c:axId val="${id}"/><c:scaling><c:orientation val="${inverter ? 'maxMin' : 'minMax'}"/></c:scaling><c:delete val="${apagar ? 1 : 0}"/>`
      + `<c:axPos val="${posicao}"/>${formato ? `<c:numFmt formatCode="${esc(formato)}" sourceLinked="0"/>` : ''}<c:majorTickMark val="none"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/>`
      + `${eixoLinha}${textoEixo}<c:crossAx val="${cruza}"/><c:crosses val="autoZero"/><c:auto val="1"/><c:lblAlgn val="ctr"/><c:lblOffset val="100"/><c:noMultiLvlLbl val="0"/></c:catAx>`;
  }
  function eixoVal(id, cruza, { posicao = 'l', grade = true, cruzaMax = false, apagar = false, formato = 'General' } = {}) {
    return `<c:valAx><c:axId val="${id}"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="${apagar ? 1 : 0}"/><c:axPos val="${posicao}"/>`
      + `${grade ? linhaGrade : ''}<c:numFmt formatCode="${esc(formato)}" sourceLinked="0"/><c:majorTickMark val="none"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/>`
      + `${semLinha}${textoEixo}<c:crossAx val="${cruza}"/><c:crosses val="${cruzaMax ? 'max' : 'autoZero'}"/><c:crossBetween val="between"/></c:valAx>`;
  }

  function graficoXml(g) {
    const cats = categoriasXml(g.categorias);
    let plot = '';
    if (g.tipo === 'barrasLinha') {
      const [b, l] = g.series;
      plot = '<c:barChart><c:barDir val="col"/><c:grouping val="clustered"/><c:varyColors val="0"/>'
        + `<c:ser><c:idx val="0"/><c:order val="0"/>${nomeSerie(b)}${corSerie(b.cor || '4472C4')}<c:invertIfNegative val="0"/>${cats}${valoresXml(b)}</c:ser>`
        + '<c:gapWidth val="80"/><c:axId val="1001"/><c:axId val="1002"/></c:barChart>'
        + '<c:lineChart><c:grouping val="standard"/><c:varyColors val="0"/>'
        + `<c:ser><c:idx val="1"/><c:order val="1"/>${nomeSerie(l)}${corLinha(l.cor || 'ED7D31')}<c:marker><c:symbol val="none"/></c:marker>${cats}${valoresXml(l, g.formatoLinha || 'General')}<c:smooth val="0"/></c:ser>`
        + '<c:marker val="1"/><c:axId val="1003"/><c:axId val="1004"/></c:lineChart>'
        + eixoCat(1001, 1002, { formato: g.categorias.formato || null })
        + eixoVal(1002, 1001, { formato: '#,##0' })
        + eixoCat(1003, 1004, { apagar: true })
        + eixoVal(1004, 1003, { posicao: 'r', grade: false, cruzaMax: true, formato: g.formatoLinha || 'General' });
    } else {
      const [b] = g.series;
      plot = '<c:barChart><c:barDir val="bar"/><c:grouping val="clustered"/><c:varyColors val="0"/>'
        + `<c:ser><c:idx val="0"/><c:order val="0"/>${nomeSerie(b)}${corSerie(b.cor || '4472C4')}<c:invertIfNegative val="0"/>`
        + '<c:dLbls><c:spPr><a:noFill/><a:ln><a:noFill/></a:ln></c:spPr>'
        + `${textoEixo}<c:showLegendKey val="0"/><c:showVal val="1"/><c:showCatName val="0"/><c:showSerName val="0"/><c:showPercent val="0"/><c:showBubbleSize val="0"/></c:dLbls>`
        + `${cats}${valoresXml(b)}</c:ser><c:gapWidth val="60"/><c:axId val="2001"/><c:axId val="2002"/></c:barChart>`
        + eixoCat(2001, 2002, { posicao: 'l', inverter: true })
        + eixoVal(2002, 2001, { posicao: 'b', formato: '#,##0' });
    }
    const titulo = `<c:title><c:tx><c:rich><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="1100" b="1"/></a:pPr><a:r><a:rPr lang="pt-BR" sz="1100" b="1"><a:solidFill><a:srgbClr val="404040"/></a:solidFill></a:rPr><a:t>${esc(g.titulo)}</a:t></a:r></a:p></c:rich></c:tx><c:overlay val="0"/></c:title>`;
    const legenda = g.tipo === 'barrasLinha' ? `<c:legend><c:legendPos val="b"/><c:overlay val="0"/>${textoEixo}</c:legend>` : '';
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
      + '<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
      + '<c:lang val="pt-BR"/><c:roundedCorners val="0"/>'
      + `<c:chart>${titulo}<c:autoTitleDeleted val="0"/><c:plotArea><c:layout/>${plot}</c:plotArea>${legenda}<c:plotVisOnly val="1"/><c:dispBlanksAs val="gap"/></c:chart>`
      + '<c:spPr><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill><a:ln w="9525"><a:solidFill><a:srgbClr val="D9D9D9"/></a:solidFill></a:ln></c:spPr>'
      + '<c:txPr><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="900"><a:latin typeface="Calibri"/></a:defRPr></a:pPr><a:endParaRPr lang="pt-BR"/></a:p></c:txPr>'
      + '</c:chartSpace>';
  }

  function desenhoXml(graficos, idsRel) {
    const ancora = (g, k) => `<xdr:twoCellAnchor editAs="oneCell"><xdr:from><xdr:col>${g.de[0]}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${g.de[1]}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from>`
      + `<xdr:to><xdr:col>${g.ate[0]}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${g.ate[1]}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to>`
      + `<xdr:graphicFrame macro=""><xdr:nvGraphicFramePr><xdr:cNvPr id="${k + 2}" name="Gráfico ${k + 1}"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr>`
      + '<xdr:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></xdr:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart">'
      + `<c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" r:id="${idsRel[k]}"/></a:graphicData></a:graphic></xdr:graphicFrame><xdr:clientData/></xdr:twoCellAnchor>`;
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
      + '<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
      + `${graficos.map(ancora).join('')}</xdr:wsDr>`;
  }

  /* ---------------- Pasta de trabalho ---------------- */

  const rels = (lista) => '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
    + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
    + `${lista.map(([id, tipo, alvo]) => `<Relationship Id="${id}" Type="http://schemas.openxmlformats.org/${tipo}" Target="${alvo}"/>`).join('')}</Relationships>`;

  function gerar({ autor = '', titulo = '', aplicativo = 'Carro Controle EM80', planilhas }) {
    const arquivos = [];
    const tipos = [
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>',
      '<Default Extension="xml" ContentType="application/xml"/>',
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>',
      '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>',
      '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>',
      '<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>'
    ];
    let nTabela = 0; let nGrafico = 0; let nDesenho = 0;
    planilhas.forEach((p, i) => {
      const n = i + 1;
      const relsPlanilha = [];
      let relDesenho = null;
      const relTabelas = [];
      (p.tabelas || []).forEach((t) => {
        nTabela++;
        const id = `rId${relsPlanilha.length + 1}`;
        relsPlanilha.push([id, 'officeDocument/2006/relationships/table', `../tables/table${nTabela}.xml`]);
        relTabelas.push(id);
        arquivos.push([`xl/tables/table${nTabela}.xml`, tabelaXml(t, nTabela, p)]);
        tipos.push(`<Override PartName="/xl/tables/table${nTabela}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.table+xml"/>`);
      });
      if ((p.graficos || []).length) {
        nDesenho++;
        relDesenho = `rId${relsPlanilha.length + 1}`;
        relsPlanilha.push([relDesenho, 'officeDocument/2006/relationships/drawing', `../drawings/drawing${nDesenho}.xml`]);
        const relsDesenho = [];
        p.graficos.forEach((g) => {
          nGrafico++;
          relsDesenho.push([`rId${relsDesenho.length + 1}`, 'officeDocument/2006/relationships/chart', `../charts/chart${nGrafico}.xml`]);
          arquivos.push([`xl/charts/chart${nGrafico}.xml`, graficoXml(g)]);
          tipos.push(`<Override PartName="/xl/charts/chart${nGrafico}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/>`);
        });
        arquivos.push([`xl/drawings/drawing${nDesenho}.xml`, desenhoXml(p.graficos, relsDesenho.map((r) => r[0]))]);
        arquivos.push([`xl/drawings/_rels/drawing${nDesenho}.xml.rels`, rels(relsDesenho)]);
        tipos.push(`<Override PartName="/xl/drawings/drawing${nDesenho}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>`);
      }
      arquivos.push([`xl/worksheets/sheet${n}.xml`, planilhaXml({ ...p, selecionada: i === 0 }, relDesenho, relTabelas)]);
      if (relsPlanilha.length) arquivos.push([`xl/worksheets/_rels/sheet${n}.xml.rels`, rels(relsPlanilha)]);
      tipos.push(`<Override PartName="/xl/worksheets/sheet${n}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`);
    });
    const agora = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
    const nomesPlanilhas = planilhas.map((p) => esc(String(p.nome).slice(0, 31)));
    arquivos.unshift(
      ['[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">${tipos.join('')}</Types>`],
      ['_rels/.rels', rels([
        ['rId1', 'officeDocument/2006/relationships/officeDocument', 'xl/workbook.xml'],
        ['rId2', 'package/2006/relationships/metadata/core-properties', 'docProps/core.xml'],
        ['rId3', 'officeDocument/2006/relationships/extended-properties', 'docProps/app.xml']])],
      ['docProps/core.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">'
        + `<dc:title>${esc(titulo)}</dc:title><dc:creator>${esc(autor)}</dc:creator><cp:lastModifiedBy>${esc(autor)}</cp:lastModifiedBy>`
        + `<dcterms:created xsi:type="dcterms:W3CDTF">${agora}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${agora}</dcterms:modified></cp:coreProperties>`],
      ['docProps/app.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">'
        + `<Application>${esc(aplicativo)}</Application><DocSecurity>0</DocSecurity><ScaleCrop>false</ScaleCrop><Company>${esc(autor)}</Company></Properties>`],
      ['xl/workbook.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
        + '<bookViews><workbookView activeTab="0"/></bookViews>'
        + `<sheets>${nomesPlanilhas.map((nm, i) => `<sheet name="${nm}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets><calcPr calcId="191029"/></workbook>`],
      ['xl/_rels/workbook.xml.rels', rels([
        ...planilhas.map((_, i) => [`rId${i + 1}`, 'officeDocument/2006/relationships/worksheet', `worksheets/sheet${i + 1}.xml`]),
        [`rId${planilhas.length + 1}`, 'officeDocument/2006/relationships/styles', 'styles.xml']])],
      ['xl/styles.xml', estilosXml()]);
    return zip(arquivos);
  }

  /** Baixa o arquivo gerado. */
  function baixar(bytes, nome) {
    const blob = new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = nome;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }

  App.xlsx = { gerar, baixar, serial, letra, ref, absoluta, ESTILOS: NOMES_ESTILO };
})(window.App);
