/*
 * Gera um CSV no formato do carro controle, com dados inventados e resultado conhecido:
 * 1.000 m (km 2+500 → 1+500, decrescente), a cada 0,25 m:
 *   T01: 300 m reta | C01: 200 m curva (10000/R = 20) | T02: 300 m reta | C02: 200 m curva (−15).
 *   Perda de bitola (F − T = 3 mm) em 50 m dentro de T02 (de 2+000−20 a 2+000−70).
 *   KLD = Bitola F − 1. Picos de NLmax_20: +9 em 2+300 e −12 em 1+700.
 */
export const CABECALHO = ['H', 'RAMAL', 'CORRETIVA', 'INSPETOR', 'LINHA', 'Car', 'DATA', 'KM', 'SEQU NCIA', 'LOCALIZACAO', 'DataBreak',
  'Extended Location', 'Speed   ', 'EX      ', 'Bitola F', 'Bitola T', 'SUPerABS', 'Warp    ', 'EMP_ 2  ', 'EMP_10  ', 'EMP_20  ',
  'ALmax_10', 'AL10_B10', 'AL20_B10', 'VAL_B2,5', 'VrBTmax5', 'NLmax_5 ', 'NLmax_20', '10000/R ', 'Bit_KLD ', 'C Esq   ',
  'C Dir   ', 'F Esq   ', 'F Dir   ', 'INC Tr E', 'INC Tr D', 'SPC_NL_E', 'SPC_NL_D', 'NL_TQI  ', 'SPC_AL_E', 'SPC_AL_D',
  'ALR10_10', 'ALR10_20', 'TIPOTR_E', 'TIPOTR_D', 'Lat', 'Long', 'Alt'];

const f = (v) => (v === null ? ' ******* ' : `${v.toFixed(2).padStart(8)}`);

export function gerarCSV({ salto = 0 } = {}) {
  const linhas = [];
  const inicio = 2500; // metros
  linhas.push(['E', 'TST', 'XX1', 'TESTE', '1', 'EM80', '01/09/2026', '2', 'D', '500.00  ', '0', '1', '1', '211', 'REAR DESK ON', '0', '0', '0'].join(';'));
  linhas.push(CABECALHO.join(';'));
  for (let k = 0; k < 4000; k++) {
    const p = inicio - k * 0.25 - (k >= 2400 ? salto : 0); // salto: o km pula (acerto em campo) no ponto 2400
    const d = k * 0.25; // distância percorrida
    const km = Math.floor(p / 1000);
    const loc = p - km * 1000;
    let curv = 0;
    if (d >= 300 && d < 500) curv = 20;
    if (d >= 800) curv = -15;
    const bitF = 3;
    const bitT = d >= 520 && d < 570 ? 0 : 3;
    let nl20 = Math.sin(k / 7) * 1.5;
    if (Math.abs(p - 2300) < 0.01) nl20 = 9;
    if (Math.abs(p - 1700) < 0.01) nl20 = -12;
    const v = {
      speed: 50, bitF, bitT, curv, kld: bitF - 1, nl20, alr: Math.cos(k / 9) * 2,
      falta: k % 500 === 7 // alguns valores ausentes
    };
    const col = new Array(CABECALHO.length).fill(f(0));
    col[0] = 'D'; col[1] = 'TST'; col[2] = 'XX1'; col[3] = 'TESTE'; col[4] = '1'; col[5] = 'EM80'; col[6] = '01/09/2026';
    col[7] = String(km); col[8] = 'D'; col[9] = `${loc.toFixed(2)}  `; col[10] = '0'; col[11] = '1';
    col[12] = f(v.speed); col[14] = f(bitF); col[15] = f(bitT);
    col[27] = f(nl20); col[28] = v.falta ? f(null) : f(curv); col[29] = f(v.kld); col[41] = f(v.alr);
    col[45] = '0'; col[46] = '0'; col[47] = '0';
    linhas.push(col.join(';'));
    if (Math.abs(p - 2000) < 0.01) {
      linhas.push(['E', 'TST', 'XX1', 'TESTE', '1', 'EM80', '01/09/2026', '2', 'D', '0.00  ', '0', '1', '1', '12', 'INICIO AMV', '0', '0', '0'].join(';'));
    }
  }
  return `${linhas.join('\r\n')}\r\n`;
}
