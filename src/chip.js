#!/usr/bin/env node
// Controle dos chips: registrar ativacao e ver em que dia do aquecimento cada um esta.
const path = require('path');
const fs = require('fs');
const { ativarChip, lerChip, cotaDoDia, listarPerfis } = require('./aquecimento');

const RAIZ = path.join(__dirname, '..');
const curva = JSON.parse(fs.readFileSync(path.join(RAIZ, 'config.json'), 'utf8')).aquecimento.curva;

const [acao, perfil, ...resto] = process.argv.slice(2);

function ajuda() {
  console.log(`
Uso:
  npm run chip -- ativar <perfil> [AAAA-MM-DD] [apelido]   registra o inicio do aquecimento
  npm run chip -- status                                    mostra todos os chips
`);
}

if (acao === 'ativar') {
  if (!perfil) {
    console.error('Falta o nome do perfil. Ex: npm run chip -- ativar chip1 2026-08-20 "Chip 1"');
    process.exit(1);
  }
  const data = resto.find((r) => /^\d{4}-\d{2}-\d{2}$/.test(r));
  const apelido = resto.find((r) => !/^\d{4}-\d{2}-\d{2}$/.test(r));
  const chip = ativarChip(RAIZ, perfil, { data, apelido });
  const { dia, cota } = cotaDoDia(RAIZ, perfil, curva);
  console.log(`\nChip "${chip.apelido}" (perfil ${perfil}) ativado em ${chip.ativadoEm}.`);
  console.log(`Hoje e o dia ${dia} do aquecimento — cota de ${cota} envios.\n`);
} else if (acao === 'status' || !acao) {
  const perfis = listarPerfis(RAIZ);
  if (perfis.length === 0) {
    console.log('\nNenhum chip registrado ainda. Use: npm run chip -- ativar chip1\n');
    process.exit(0);
  }
  console.log('\nperfil        apelido            ativado em    dia   cota hoje');
  console.log('-------------------------------------------------------------');
  for (const p of perfis) {
    const chip = lerChip(RAIZ, p);
    const { dia, cota } = cotaDoDia(RAIZ, p, curva);
    console.log(
      `${p.padEnd(13)} ${(chip?.apelido || '-').padEnd(18)} ${(chip?.ativadoEm || 'nao registrado').padEnd(13)} ${String(dia).padEnd(5)} ${cota}`
    );
  }
  console.log('');
} else {
  ajuda();
  process.exit(1);
}
