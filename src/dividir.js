#!/usr/bin/env node
// Divide a base entre os chips, fixando cada contato em um perfil.
// Um contato que ja tem perfil nunca muda de chip — quem recebeu de um numero
// continua recebendo daquele numero.
const fs = require('fs');
const path = require('path');
const { dividirLinha, detectarSeparador, normalizarChave } = require('./contatos');

const RAIZ = path.join(__dirname, '..');

function lerArgumentos(argv) {
  const args = { arquivo: null, chips: [], fatia: null, saida: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--chips') args.chips = String(argv[++i] || '').split(',').map((c) => c.trim()).filter(Boolean);
    else if (a === '--fatia') args.fatia = parseInt(argv[++i], 10);
    else if (a === '--saida') args.saida = argv[++i];
    else if (!a.startsWith('-') && !args.arquivo) args.arquivo = a;
  }
  return args;
}

function main() {
  const args = lerArgumentos(process.argv.slice(2));

  if (!args.arquivo || args.chips.length === 0) {
    console.log(`
Uso: npm run dividir -- <contatos.csv> --chips chip1,chip2,chip3 [--fatia 3000] [--saida outro.csv]

  --chips   perfis que vao dividir a base (a ordem nao importa)
  --fatia   usa so os N primeiros contatos do arquivo (a base ja vem ordenada
            por recencia no export, entao a fatia = os mais quentes)
  --saida   grava em outro arquivo em vez de reescrever o original
`);
    process.exit(1);
  }

  const entrada = path.resolve(RAIZ, args.arquivo);
  const conteudo = fs.readFileSync(entrada, 'utf8').replace(/^﻿/, '');
  const linhas = conteudo.split(/\r?\n/).filter((l) => l.trim() !== '');
  const separador = detectarSeparador(linhas[0]);
  const colunas = dividirLinha(linhas[0], separador).map(normalizarChave);

  let indicePerfil = colunas.indexOf('perfil');
  const cabecalhoNovo = indicePerfil === -1 ? [...colunas, 'perfil'] : colunas;
  if (indicePerfil === -1) indicePerfil = cabecalhoNovo.length - 1;

  let registros = linhas.slice(1).map((linha) => {
    const valores = dividirLinha(linha, separador);
    while (valores.length < cabecalhoNovo.length) valores.push('');
    return valores;
  });

  if (args.fatia) registros = registros.slice(0, args.fatia);

  // Quem ja tem chip continua nele; conta para equilibrar o resto.
  const carga = Object.fromEntries(args.chips.map((c) => [c, 0]));
  const semChip = [];

  for (const valores of registros) {
    const atual = (valores[indicePerfil] || '').trim();
    if (atual && carga[atual] !== undefined) carga[atual]++;
    else if (atual) carga[atual] = (carga[atual] || 0) + 1;
    else semChip.push(valores);
  }

  // Round-robin na ordem do arquivo: cada chip recebe a mesma mistura
  // de contatos quentes e frios, em vez de um chip so com os antigos.
  let i = 0;
  for (const valores of semChip) {
    const chip = args.chips[i % args.chips.length];
    valores[indicePerfil] = chip;
    carga[chip]++;
    i++;
  }

  const saida = path.resolve(RAIZ, args.saida || args.arquivo);
  const csv = [cabecalhoNovo.join(';')]
    .concat(registros.map((v) => v.map((c) => String(c).replace(/;/g, ' ')).join(';')))
    .join('\n');
  fs.writeFileSync(saida, csv + '\n', 'utf8');

  console.log(`\n=== Base dividida: ${registros.length} contatos ===`);
  for (const chip of Object.keys(carga)) {
    console.log(`  ${chip.padEnd(16)} ${carga[chip]}`);
  }
  console.log(`\n  Arquivo: ${path.relative(RAIZ, saida)}`);
  console.log('  Cada chip dispara so para a fatia dele:');
  console.log(`    npm start -- <campanha> --perfil ${args.chips[0]}\n`);
}

main();
