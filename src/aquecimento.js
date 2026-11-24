const fs = require('fs');
const path = require('path');

// Estado do chip fica junto da sessao dele: um arquivo por perfil.
function arquivoChip(raiz, perfil) {
  return path.join(raiz, 'sessoes', perfil, 'chip.json');
}

function lerChip(raiz, perfil) {
  const caminho = arquivoChip(raiz, perfil);
  if (!fs.existsSync(caminho)) return null;
  return JSON.parse(fs.readFileSync(caminho, 'utf8'));
}

function salvarChip(raiz, perfil, dados) {
  const caminho = arquivoChip(raiz, perfil);
  fs.mkdirSync(path.dirname(caminho), { recursive: true });
  fs.writeFileSync(caminho, JSON.stringify(dados, null, 2), 'utf8');
  return dados;
}

function ativarChip(raiz, perfil, { data, apelido } = {}) {
  const existente = lerChip(raiz, perfil) || {};
  return salvarChip(raiz, perfil, {
    ...existente,
    perfil,
    apelido: apelido || existente.apelido || perfil,
    ativadoEm: data || existente.ativadoEm || new Date().toISOString().slice(0, 10),
  });
}

function diasDesde(dataISO) {
  const inicio = new Date(`${dataISO}T00:00:00`);
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  return Math.floor((hoje - inicio) / 86400000) + 1; // dia da ativacao = dia 1
}

// Cota do dia segundo a curva de aquecimento. Chip sem ativacao registrada
// e tratado como dia 1 — o mais conservador possivel.
function cotaDoDia(raiz, perfil, curva) {
  const chip = lerChip(raiz, perfil);
  const dia = chip?.ativadoEm ? diasDesde(chip.ativadoEm) : 1;

  let cota = curva[curva.length - 1]?.porDia ?? 0;
  for (const faixa of curva) {
    if (faixa.ateDia === null || faixa.ateDia === undefined || dia <= faixa.ateDia) {
      cota = faixa.porDia;
      break;
    }
  }

  return { dia, cota, chip };
}

function listarPerfis(raiz) {
  const pasta = path.join(raiz, 'sessoes');
  if (!fs.existsSync(pasta)) return [];
  return fs.readdirSync(pasta).filter((n) => fs.statSync(path.join(pasta, n)).isDirectory());
}

module.exports = { ativarChip, lerChip, salvarChip, cotaDoDia, diasDesde, listarPerfis, arquivoChip };
