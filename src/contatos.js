const fs = require('fs');

// Divide uma linha de CSV respeitando aspas duplas.
function dividirLinha(linha, separador) {
  const campos = [];
  let atual = '';
  let dentroDeAspas = false;

  for (let i = 0; i < linha.length; i++) {
    const c = linha[i];
    if (c === '"') {
      if (dentroDeAspas && linha[i + 1] === '"') { atual += '"'; i++; }
      else dentroDeAspas = !dentroDeAspas;
    } else if (c === separador && !dentroDeAspas) {
      campos.push(atual);
      atual = '';
    } else {
      atual += c;
    }
  }
  campos.push(atual);
  return campos.map((c) => c.trim());
}

function detectarSeparador(cabecalho) {
  const virgulas = (cabecalho.match(/,/g) || []).length;
  const pontoEVirgula = (cabecalho.match(/;/g) || []).length;
  return pontoEVirgula > virgulas ? ';' : ',';
}

function normalizarChave(texto) {
  return texto
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');
}

// Gera os candidatos de numero E.164 para o Brasil.
// Celular com 8 digitos vira candidato com 9 na frente e vice-versa,
// porque bases antigas costumam ter os dois formatos misturados.
function candidatosNumero(bruto) {
  let digitos = String(bruto || '').replace(/\D/g, '');
  if (!digitos) return [];

  if (digitos.startsWith('55') && digitos.length >= 12) digitos = digitos.slice(2);
  if (digitos.startsWith('0')) digitos = digitos.replace(/^0+/, '');

  // Numero internacional (nao-BR): usa como veio.
  if (digitos.length > 11) return [digitos];
  if (digitos.length < 10) return [];

  const ddd = digitos.slice(0, 2);
  const resto = digitos.slice(2);
  const candidatos = new Set();

  if (resto.length === 9) {
    candidatos.add(`55${ddd}${resto}`);
    if (resto.startsWith('9')) candidatos.add(`55${ddd}${resto.slice(1)}`);
  } else if (resto.length === 8) {
    if (/^[6-9]/.test(resto)) candidatos.add(`55${ddd}9${resto}`);
    candidatos.add(`55${ddd}${resto}`);
  }

  return [...candidatos];
}

function ehOptinPositivo(valor) {
  if (valor === undefined || valor === null || valor === '') return false;
  return ['sim', 's', 'true', '1', 'yes', 'ok', 'x'].includes(String(valor).trim().toLowerCase());
}

function carregarContatos(caminho, { exigirOptin = true } = {}) {
  const conteudo = fs.readFileSync(caminho, 'utf8').replace(/^\uFEFF/, '');
  const linhas = conteudo.split(/\r?\n/).filter((l) => l.trim() !== '');
  if (linhas.length < 2) throw new Error(`CSV sem contatos: ${caminho}`);

  const separador = detectarSeparador(linhas[0]);
  const colunas = dividirLinha(linhas[0], separador).map(normalizarChave);

  const colunaTelefone = colunas.find((c) => ['telefone', 'celular', 'whatsapp', 'numero', 'fone', 'contato'].includes(c));
  if (!colunaTelefone) throw new Error('O CSV precisa de uma coluna "telefone" (ou celular/whatsapp/numero).');

  const contatos = [];
  const descartados = [];
  const vistos = new Set();

  for (let i = 1; i < linhas.length; i++) {
    const valores = dividirLinha(linhas[i], separador);
    const campos = {};
    colunas.forEach((coluna, idx) => { campos[coluna] = valores[idx] ?? ''; });

    const bruto = campos[colunaTelefone];
    const candidatos = candidatosNumero(bruto);

    if (candidatos.length === 0) {
      descartados.push({ linha: i + 1, bruto, motivo: 'telefone invalido' });
      continue;
    }

    if (exigirOptin && 'optin' in campos && !ehOptinPositivo(campos.optin)) {
      descartados.push({ linha: i + 1, bruto, motivo: 'sem opt-in' });
      continue;
    }

    const chave = candidatos[0];
    if (vistos.has(chave)) {
      descartados.push({ linha: i + 1, bruto, motivo: 'duplicado no CSV' });
      continue;
    }
    vistos.add(chave);

    const nome = campos.nome || campos.primeiro_nome || campos.cliente || '';
    contatos.push({
      linha: i + 1,
      bruto,
      candidatos,
      numero: candidatos[0],
      nome,
      primeiroNome: nome.trim().split(/\s+/)[0] || '',
      perfil: (campos.perfil || '').trim(),
      diasSemFalar: campos.dias_sem_falar === '' || campos.dias_sem_falar === undefined
        ? null
        : Number(campos.dias_sem_falar),
      campos,
    });
  }

  return {
    contatos,
    descartados,
    temColunaOptin: colunas.includes('optin'),
    temColunaPerfil: colunas.includes('perfil'),
  };
}

module.exports = {
  carregarContatos,
  candidatosNumero,
  normalizarChave,
  dividirLinha,
  detectarSeparador,
};
