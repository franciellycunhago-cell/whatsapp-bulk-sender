const fs = require('fs');
const path = require('path');
const optout = require('./optout');

const CABECALHO_RESPOSTAS = 'data_hora;numero;perfil;texto\n';

function extrairTexto(mensagem) {
  const m = mensagem || {};
  return (
    m.conversation ||
    m.extendedTextMessage?.text ||
    m.imageMessage?.caption ||
    m.videoMessage?.caption ||
    m.buttonsResponseMessage?.selectedDisplayText ||
    m.listResponseMessage?.title ||
    ''
  );
}

function registrarResposta(raiz, { numero, perfil, texto }) {
  const caminho = path.join(raiz, 'respostas.csv');
  if (!fs.existsSync(caminho)) fs.writeFileSync(caminho, CABECALHO_RESPOSTAS, 'utf8');

  const limpo = (v) => String(v ?? '').replace(/[;\r\n]+/g, ' ').trim();
  const linha = [
    new Date().toISOString().replace('T', ' ').slice(0, 19),
    optout.soDigitos(numero),
    limpo(perfil),
    limpo(texto).slice(0, 140),
  ].join(';');

  fs.appendFileSync(caminho, linha + '\n', 'utf8');
}

// Escuta o que chega no chip: registra toda resposta e tira da lista
// quem pedir. O opt-out vale para todas as campanhas, nao so para esta.
function ligarEscuta(sock, { raiz, perfil, listaOptout, confirmarSaida = true }) {
  const jaConfirmados = new Set();
  const contadores = { respostas: 0, saidas: 0 };
  let sockAtual = sock;

  const aoChegar = async ({ messages, type }) => {
    if (type !== 'notify') return;

    for (const msg of messages || []) {
      const jid = msg.key?.remoteJid || '';
      if (msg.key?.fromMe) continue;
      if (!jid.endsWith('@s.whatsapp.net')) continue; // ignora grupos e status

      const numero = optout.soDigitos(jid.split('@')[0]);
      const texto = extrairTexto(msg.message);
      if (!numero) continue;

      contadores.respostas++;
      registrarResposta(raiz, { numero, perfil, texto });

      if (!optout.ehPedidoDeSaida(texto)) continue;
      if (listaOptout.has(numero)) continue;

      listaOptout.add(numero);
      optout.registrar(raiz, { numero, perfil, origem: 'resposta', mensagem: texto });
      contadores.saidas++;
      console.log(`  [opt-out] ${numero} pediu para sair — removido de todas as campanhas`);

      if (confirmarSaida && !jaConfirmados.has(numero)) {
        jaConfirmados.add(numero);
        try {
          await sockAtual.sendMessage(jid, {
            text: 'Pronto, não te mando mais mensagens por aqui. Obrigada! 🙏',
          });
        } catch {
          // se a confirmacao falhar, o descadastro ja esta registrado
        }
      }
    }
  };

  sockAtual.ev.on('messages.upsert', aoChegar);

  // Quando a linha cai, o Baileys monta um socket novo e o antigo para de
  // entregar eventos. Sem religar a escuta no socket novo, toda resposta e
  // todo pedido de saida que chegasse depois da primeira queda passaria em
  // branco — inclusive opt-outs, que nao podem ser perdidos.
  contadores.religar = (novoSock) => {
    if (!novoSock || novoSock === sockAtual) return;
    sockAtual = novoSock;
    novoSock.ev.on('messages.upsert', aoChegar);
  };

  return contadores;
}

module.exports = { ligarEscuta, registrarResposta, extrairTexto };
