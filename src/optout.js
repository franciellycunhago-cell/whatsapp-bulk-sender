const fs = require('fs');
const path = require('path');

const CABECALHO = 'data_hora;numero;perfil;origem;mensagem\n';

// Pedidos de saida que valem sozinhos, sem mais nada na mensagem.
// "nao" e "para" ficam de fora de proposito: sao resposta negativa a oferta
// ("nao", "para mim nao"), nao pedido de descadastro.
const PALAVRAS = [
  'sair', 'pare', 'parar', 'cancelar', 'cancela', 'descadastrar',
  'descadastra', 'remover', 'remove', 'stop', 'chega',
];

// Frases que valem mesmo dentro de uma mensagem curta.
const FRASES = [
  'nao quero receber', 'nao quero mais receber', 'nao quero mais',
  'me tira da lista', 'me tire da lista', 'tira da lista', 'sair da lista',
  'me remove', 'me remova', 'me descadastra', 'de mandar', 'de enviar',
  'nao me manda', 'nao me mande', 'nao envie mais',
  'cancelar inscricao', 'me exclui', 'nao tenho interesse',
];

function arquivo(raiz) {
  return path.join(raiz, 'optout.csv');
}

function normalizar(texto) {
  return String(texto || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Conservador de proposito: "vou sair mais tarde" nao pode virar descadastro.
// So conta se a mensagem inteira for a palavra, ou se for curta e contiver a frase.
function ehPedidoDeSaida(texto) {
  const limpo = normalizar(texto);
  if (!limpo) return false;
  if (PALAVRAS.includes(limpo)) return true;
  if (limpo.length <= 60 && FRASES.some((f) => limpo.includes(f))) return true;
  return false;
}

function soDigitos(valor) {
  return String(valor || '').replace(/\D/g, '');
}

function carregar(raiz) {
  const caminho = arquivo(raiz);
  const numeros = new Set();
  if (!fs.existsSync(caminho)) return numeros;

  const linhas = fs.readFileSync(caminho, 'utf8').split(/\r?\n/).slice(1);
  for (const linha of linhas) {
    if (!linha.trim()) continue;
    const numero = soDigitos(linha.split(';')[1]);
    if (!numero) continue;
    numeros.add(numero);
    // Guarda tambem a variante sem o nono digito, para casar com bases antigas.
    if (numero.length === 13 && numero.startsWith('55')) {
      numeros.add(numero.slice(0, 4) + numero.slice(5));
    }
  }
  return numeros;
}

function registrar(raiz, { numero, perfil, origem, mensagem }) {
  const caminho = arquivo(raiz);
  if (!fs.existsSync(caminho)) fs.writeFileSync(caminho, CABECALHO, 'utf8');

  const limpo = (v) => String(v ?? '').replace(/[;\r\n]+/g, ' ').trim();
  const linha = [
    new Date().toISOString().replace('T', ' ').slice(0, 19),
    soDigitos(numero),
    limpo(perfil),
    limpo(origem),
    limpo(mensagem).slice(0, 140),
  ].join(';');

  fs.appendFileSync(caminho, linha + '\n', 'utf8');
}

// Um contato esta fora se qualquer uma das variantes do numero dele saiu da lista.
function estaNaListaDeSaida(listaOptout, contato) {
  return contato.candidatos.some((n) => listaOptout.has(soDigitos(n)));
}

module.exports = { carregar, registrar, ehPedidoDeSaida, estaNaListaDeSaida, arquivo, soDigitos };
