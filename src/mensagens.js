const fs = require('fs');
const path = require('path');
const { normalizarChave } = require('./contatos');

// Cada arquivo .txt da pasta mensagens/ e uma versao da copy.
function carregarVariacoes(pastaMensagens) {
  if (!fs.existsSync(pastaMensagens)) {
    throw new Error(`Pasta de mensagens nao encontrada: ${pastaMensagens}`);
  }

  const arquivos = fs.readdirSync(pastaMensagens)
    .filter((a) => a.toLowerCase().endsWith('.txt'))
    .sort();

  if (arquivos.length === 0) {
    throw new Error(`Nenhum arquivo .txt em ${pastaMensagens}. Crie ao menos uma versao da mensagem.`);
  }

  return arquivos.map((arquivo) => ({
    nome: path.basename(arquivo, '.txt'),
    texto: fs.readFileSync(path.join(pastaMensagens, arquivo), 'utf8').replace(/^\uFEFF/, '').trim(),
  }));
}

// Sorteio em blocos: a cada rodada todas as versoes aparecem uma vez,
// em ordem embaralhada. Distribui parelho sem virar padrao previsivel.
function criarSorteador(variacoes) {
  let fila = [];
  return function proxima() {
    if (fila.length === 0) {
      fila = [...variacoes];
      for (let i = fila.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [fila[i], fila[j]] = [fila[j], fila[i]];
      }
    }
    return fila.shift();
  };
}

// Resolve {{coluna}} com os campos do CSV e depois {a|b|c} sorteando uma opcao.
function renderizar(texto, contato) {
  const valores = {
    ...contato.campos,
    nome: contato.nome,
    primeiro_nome: contato.primeiroNome,
    primeironome: contato.primeiroNome,
    telefone: contato.bruto,
  };

  let saida = texto.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_, chave) => {
    const valor = valores[normalizarChave(chave)];
    return valor === undefined ? '' : String(valor);
  });

  let guarda = 0;
  while (/\{[^{}]+\}/.test(saida) && guarda++ < 20) {
    saida = saida.replace(/\{([^{}]+)\}/g, (_, bloco) => {
      const opcoes = bloco.split('|');
      return opcoes[Math.floor(Math.random() * opcoes.length)];
    });
  }

  return saida
    .split(/\n\s*---\s*\n/)          // "---" numa linha separa em mensagens sequenciais
    .map((parte) => limparBuracos(parte))
    .filter((parte) => parte !== '');
}

// Contato sem nome na agenda deixa buraco: "Oi {{primeiro_nome}}, tudo bem?"
// viraria "Oi , tudo bem?". Aqui a frase volta a ficar inteira.
function limparBuracos(texto) {
  return texto
    .split('\n')
    .map((linha) => {
      const limpa = linha
        .replace(/[ \t]{2,}/g, ' ')        // espaco dobrado onde a variavel sumiu
        .replace(/\s+([,.!?;:])/g, '$1')   // " ," -> ","
        .replace(/([,;:])\s*\1+/g, '$1')   // ",," -> ","
        .trimEnd();

      // So capitaliza quando a variavel que abria a frase sumiu e deixou
      // pontuacao orfa. Sem isso, um link no inicio da linha viraria "Https://".
      const semOrfa = limpa.replace(/^[\s,;:.]+/, '');
      if (semOrfa === limpa) return limpa;
      return semOrfa.replace(/^([a-záàâãéêíóôõúç])/, (c) => c.toUpperCase());
    })
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function validarVariacoes(variacoes, contatoExemplo) {
  const problemas = [];
  for (const v of variacoes) {
    const partes = renderizar(v.texto, contatoExemplo);
    const texto = partes.join('\n');
    if (texto.length === 0) problemas.push(`${v.nome}: mensagem vazia`);
    if (texto.length > 3500) problemas.push(`${v.nome}: mensagem muito longa (${texto.length} caracteres)`);
    const sobrou = texto.match(/\{\{[^}]*\}\}/g);
    if (sobrou) problemas.push(`${v.nome}: variavel sem valor no CSV -> ${sobrou.join(', ')}`);
  }
  return problemas;
}

module.exports = { carregarVariacoes, criarSorteador, renderizar, validarVariacoes };
