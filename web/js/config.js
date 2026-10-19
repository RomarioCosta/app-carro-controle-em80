/*
 * Configuração do app: perguntas do checklist e listas.
 * Para incluir/alterar perguntas, edite apenas este arquivo.
 * Os "id" identificam cada pergunta na planilha: não altere ids já usados.
 *
 * Tipos de item do checklist:
 *  - sn:       pergunta Sim/Não. "problemaEm" indica qual resposta exige descrição.
 *  - amostras: lista de valores numéricos (quantos forem necessários).
 *  - pares:    lista de pares de valores (ex.: KLD × vampiro).
 */
'use strict';

(function (App) {
  App.config = {
    versao: '1.0.0',
    build: 'em80-98db776ce0', // preenchido automaticamente pelo build (mesmo código do cache do PWA)

    checklist: [
      {
        id: 'ogms',
        titulo: 'OGMS',
        itens: [
          { tipo: 'sn', id: 'ogms_conexao', texto: 'O sistema OGMS apresentou dificuldades para conectar?', problemaEm: 'Sim' },
          { tipo: 'sn', id: 'ogms_falha', texto: 'O sistema OGMS apresentou falhas ou desconectou durante a inspeção?', problemaEm: 'Sim' },
          { tipo: 'amostras', id: 'ogms_bitola', texto: 'Diferença entre a bitola medida em campo e a medida pelo sensor' },
          { tipo: 'sn', id: 'ogms_leds', texto: 'Os LEDs da controladora apresentaram alguma instabilidade?', problemaEm: 'Sim' }
        ]
      },
      {
        id: 'kld',
        titulo: 'KLD',
        itens: [
          { tipo: 'sn', id: 'kld_conexao', texto: 'O sistema KLD apresentou dificuldades para conectar?', problemaEm: 'Sim' },
          { tipo: 'sn', id: 'kld_falha', texto: 'O sistema KLD apresentou falhas ou desconectou durante a inspeção?', problemaEm: 'Sim' },
          { tipo: 'amostras', id: 'kld_bitola', texto: 'Diferença entre a bitola do KLD e a medida pelo OGMS' },
          { tipo: 'pares', id: 'kld_desgaste', texto: 'Desgaste do trilho: medida do KLD × medida em campo (vampiro)', rotulos: ['KLD', 'Vampiro'] },
          { tipo: 'sn', id: 'kld_leds', texto: 'Os LEDs do KLD apresentaram alguma instabilidade ou sinal anômalo de erro?', problemaEm: 'Sim' }
        ]
      },
      {
        id: 'aplanix',
        titulo: 'Aplanix',
        itens: [
          { tipo: 'sn', id: 'aplanix_conexao', texto: 'O sistema Aplanix apresentou dificuldades para conectar?', problemaEm: 'Sim' },
          { tipo: 'sn', id: 'aplanix_falha', texto: 'O sistema Aplanix apresentou falhas ou desconectou durante a inspeção?', problemaEm: 'Sim' },
          { tipo: 'sn', id: 'aplanix_leds', texto: 'Os LEDs do POS/TG apresentaram alguma instabilidade?', problemaEm: 'Sim' },
          { tipo: 'sn', id: 'aplanix_nivelamento', texto: 'Os parâmetros de nivelamento apresentaram alguma perturbação inesperada?', problemaEm: 'Sim' }
        ]
      },
      {
        id: 'computadores',
        titulo: 'Computadores M1, M2 e M3',
        itens: [
          { tipo: 'sn', id: 'comp_falha', texto: 'Os computadores apresentaram alguma falha ou sinistro durante os testes?', problemaEm: 'Sim' },
          { tipo: 'sn', id: 'comp_m1_salvou', texto: 'O M1 salvou os dados conforme esperado?', problemaEm: 'Não' },
          { tipo: 'sn', id: 'comp_perifericos', texto: 'Os dispositivos de conexão (Bluetooth, teclado e mouse) funcionaram corretamente?', problemaEm: 'Não' }
        ]
      }
    ],

    /** Equipamentos do Registro de Eventos. "Outro" abre um campo de texto. */
    equipamentos: ['OGMS', 'KLD', 'Aplanix', 'M1', 'M2', 'M3', 'Outro']
  };
})(window.App);
