const path = require('path');
const fs = require('fs');
const qrcode = require('qrcode-terminal');
const pino = require('pino');
const {
  default: makeWASocket,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  DisconnectReason,
  Browsers,
} = require('@whiskeysockets/baileys');

const logger = pino({ level: 'silent' });

function pastaSessao(raiz, perfil) {
  return path.join(raiz, 'sessoes', perfil);
}

async function abrirSocket(caminhoSessao, timeoutMs, historicoCompleto) {
  fs.mkdirSync(caminhoSessao, { recursive: true });
  const { state, saveCreds } = await useMultiFileAuthState(caminhoSessao);
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    logger,
    auth: state,
    browser: Browsers.appropriate('Desktop'),
    printQRInTerminal: false,
    // Ligar isso faz o WhatsApp derrubar a conexao com 428 antes do QR.
    syncFullHistory: historicoCompleto === true,
    markOnlineOnConnect: false, // nao rouba as notificacoes do celular
  });

  sock.ev.on('creds.update', saveCreds);

  return new Promise((resolve, reject) => {
    let jaMostrouQr = false;
    let resolvido = false;

    // Em execucao agendada ninguem esta olhando a tela para ler o QR:
    // sem teto de espera, a tarefa ficaria pendurada para sempre.
    const timer = timeoutMs
      ? setTimeout(() => {
          if (resolvido) return;
          resolvido = true;
          const erro = new Error(
            `Nao conectou em ${Math.round(timeoutMs / 1000)}s. A sessao do chip pode ter expirado — rode "npm start" na mao para ler o QR.`
          );
          erro.semSessao = true;
          try { sock.ws?.close(); } catch { /* ja fechado */ }
          reject(erro);
        }, timeoutMs)
      : null;

    const encerrar = (fn, valor) => {
      if (resolvido) return;
      resolvido = true;
      if (timer) clearTimeout(timer);
      fn(valor);
    };

    sock.ev.on('connection.update', (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr && !jaMostrouQr) {
        jaMostrouQr = true;
        console.log('\n  Abra o WhatsApp no celular > Aparelhos conectados > Conectar aparelho');
        console.log('  e aponte a camera para o QR abaixo:\n');
        qrcode.generate(qr, { small: true });
      }

      if (connection === 'open') {
        const numero = (sock.user?.id || '').split(':')[0];
        console.log(`\n  Conectado como ${sock.user?.name || 'WhatsApp'} (${numero})\n`);
        encerrar(resolve, sock);
      }

      if (connection === 'close') {
        const codigo = lastDisconnect?.error?.output?.statusCode;
        const erro = new Error(
          codigo === DisconnectReason.loggedOut
            ? 'Sessao encerrada no celular. Rode "npm run sair" e conecte de novo.'
            : `Conexao caiu (codigo ${codigo ?? 'desconhecido'}).`
        );
        erro.codigo = codigo;
        encerrar(reject, erro);
      }
    });
  });
}

// Um socket derrubado continua com .user preenchido, entao perguntar so pelo
// usuario devolvia conexao morta como se estivesse boa. O que diz a verdade e
// o websocket.
function estaVivo(sock) {
  return Boolean(sock?.user && sock.ws?.isOpen);
}

// Mantem uma conexao viva e reconecta sozinho se a linha cair no meio do disparo.
function criarConexao(raiz, perfil, { timeoutMs = null, historicoCompleto = false } = {}) {
  const caminho = pastaSessao(raiz, perfil);
  let sock = null;

  return {
    caminho,
    async garantir() {
      if (estaVivo(sock)) return sock;
      let ultimoErro;
      for (let tentativa = 1; tentativa <= 3; tentativa++) {
        try {
          sock = await abrirSocket(caminho, timeoutMs, historicoCompleto);
          return sock;
        } catch (erro) {
          ultimoErro = erro;
          sock = null;
          if (erro.codigo === DisconnectReason.loggedOut || erro.semSessao) throw erro;
          console.log(`  ${erro.message} Tentando reconectar (${tentativa}/3)...`);
          await new Promise((r) => setTimeout(r, 5000 * tentativa));
        }
      }
      throw ultimoErro;
    },
    invalidar() { sock = null; },
    async encerrar() {
      try { await sock?.ws?.close(); } catch { /* ja fechado */ }
      sock = null;
    },
  };
}

module.exports = { criarConexao, pastaSessao };
