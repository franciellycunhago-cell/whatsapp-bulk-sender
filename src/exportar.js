#!/usr/bin/env node
// Exporta a base de contatos de um numero de WhatsApp que JA TEM historico
// (ex: o comercial da loja) para virar CSV de campanha.
//
// Este script NUNCA envia mensagem. Ele so conecta, le o historico e desconecta.
// Use um perfil separado dos chips de disparo (ex: --perfil leitura).
const fs = require('fs');
const path = require('path');
const qrcode = require('qrcode-terminal');
const pino = require('pino');
const {
  default: makeWASocket,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  Browsers,
} = require('@whiskeysockets/baileys');

const RAIZ = path.join(__dirname, '..');

function lerArgumentos(argv) {
  const args = { perfil: 'leitura', saida: null, espera: 90, minDias: null, maxDias: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--perfil') args.perfil = argv[++i];
    else if (a === '--saida') args.saida = argv[++i];
    else if (a === '--espera') args.espera = parseInt(argv[++i], 10);
    else if (a === '--min-dias') args.minDias = parseInt(argv[++i], 10);
    else if (a === '--max-dias') args.maxDias = parseInt(argv[++i], 10);
  }
  return args;
}

// conversationTimestamp pode vir como number ou como Long do protobuf.
function paraSegundos(valor) {
  if (!valor) return 0;
  if (typeof valor === 'number') return valor;
  if (typeof valor === 'string') return parseInt(valor, 10) || 0;
  if (typeof valor.toNumber === 'function') return valor.toNumber();
  if (typeof valor.low === 'number') return valor.low;
  return 0;
}

function ehContatoPessoal(jid) {
  return typeof jid === 'string' && jid.endsWith('@s.whatsapp.net');
}

function escapar(valor) {
  return String(valor ?? '').replace(/[;\r\n]+/g, ' ').trim();
}

async function main() {
  const args = lerArgumentos(process.argv.slice(2));
  const saida = path.resolve(RAIZ, args.saida || `export-${args.perfil}-${new Date().toISOString().slice(0, 10)}.csv`);
  const caminhoSessao = path.join(RAIZ, 'sessoes', args.perfil);
  fs.mkdirSync(caminhoSessao, { recursive: true });

  console.log('\n=== Export de base — modo somente leitura ===');
  console.log(`  Perfil ....... ${args.perfil}`);
  console.log(`  Saida ........ ${path.relative(RAIZ, saida)}`);
  console.log(`  Espera ....... ${args.espera}s de sincronizacao`);
  console.log('  Este script nao envia nenhuma mensagem.\n');

  const { state, saveCreds } = await useMultiFileAuthState(caminhoSessao);
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    logger: pino({ level: 'silent' }),
    auth: state,
    browser: Browsers.appropriate('Desktop'),
    printQRInTerminal: false,
    syncFullHistory: true,      // precisa do historico completo para pegar a base
    markOnlineOnConnect: false, // nao rouba notificacao do celular
  });

  sock.ev.on('creds.update', saveCreds);

  const conversas = new Map(); // jid -> ultimo timestamp em segundos
  const nomes = new Map();     // jid -> melhor nome conhecido
  let ultimoEvento = Date.now();
  let jaMostrouQr = false;

  function anotarNome(jid, ...candidatos) {
    const nome = candidatos.find((c) => c && String(c).trim());
    if (nome && !nomes.has(jid)) nomes.set(jid, String(nome).trim());
  }

  function anotarConversa(jid, timestamp) {
    if (!ehContatoPessoal(jid)) return;
    const atual = conversas.get(jid) || 0;
    if (timestamp > atual) conversas.set(jid, timestamp);
    else if (!conversas.has(jid)) conversas.set(jid, timestamp);
    ultimoEvento = Date.now();
  }

  sock.ev.on('messaging-history.set', ({ chats = [], contacts = [], messages = [] }) => {
    for (const chat of chats) {
      anotarConversa(chat.id, paraSegundos(chat.conversationTimestamp));
      anotarNome(chat.id, chat.name);
    }
    for (const contato of contacts) {
      anotarNome(contato.id, contato.name, contato.notify, contato.verifiedName);
      if (ehContatoPessoal(contato.id) && !conversas.has(contato.id)) conversas.set(contato.id, 0);
    }
    for (const msg of messages) {
      anotarConversa(msg.key?.remoteJid, paraSegundos(msg.messageTimestamp));
    }
    ultimoEvento = Date.now();
    process.stdout.write(`\r  Sincronizando... ${conversas.size} contatos encontrados     `);
  });

  sock.ev.on('contacts.upsert', (contatos) => {
    for (const contato of contatos) {
      anotarNome(contato.id, contato.name, contato.notify, contato.verifiedName);
      if (ehContatoPessoal(contato.id) && !conversas.has(contato.id)) conversas.set(contato.id, 0);
    }
    ultimoEvento = Date.now();
  });

  sock.ev.on('chats.upsert', (chats) => {
    for (const chat of chats) {
      anotarConversa(chat.id, paraSegundos(chat.conversationTimestamp));
      anotarNome(chat.id, chat.name);
    }
  });

  await new Promise((resolve, reject) => {
    sock.ev.on('connection.update', ({ connection, qr, lastDisconnect }) => {
      if (qr && !jaMostrouQr) {
        jaMostrouQr = true;
        console.log('  Conecte o NUMERO QUE JA TEM A BASE (ex: comercial da loja):\n');
        qrcode.generate(qr, { small: true });
      }
      if (connection === 'open') {
        console.log(`\n  Conectado como ${sock.user?.name || ''} (${(sock.user?.id || '').split(':')[0]})`);
        console.log('  Aguardando o WhatsApp enviar o historico...\n');
        resolve();
      }
      if (connection === 'close') {
        reject(new Error(`Conexao fechada: ${lastDisconnect?.error?.message || 'motivo desconhecido'}`));
      }
    });
  });

  // Termina quando parar de chegar dado novo, ou no teto de espera.
  const limite = Date.now() + args.espera * 1000;
  while (Date.now() < limite && Date.now() - ultimoEvento < 20000) {
    await new Promise((r) => setTimeout(r, 1000));
  }

  const agora = Math.floor(Date.now() / 1000);
  const linhas = [...conversas.entries()]
    .filter(([jid]) => ehContatoPessoal(jid))
    .map(([jid, ts]) => {
      const numero = jid.split('@')[0];
      const dias = ts > 0 ? Math.floor((agora - ts) / 86400) : null;
      return {
        nome: nomes.get(jid) || '',
        numero,
        ultima: ts > 0 ? new Date(ts * 1000).toISOString().slice(0, 10) : '',
        dias,
      };
    })
    .filter((c) => {
      if (args.minDias !== null && (c.dias === null || c.dias < args.minDias)) return false;
      if (args.maxDias !== null && (c.dias === null || c.dias > args.maxDias)) return false;
      return true;
    })
    .sort((a, b) => (a.dias === null ? 1e9 : a.dias) - (b.dias === null ? 1e9 : b.dias));

  fs.mkdirSync(path.dirname(saida), { recursive: true });
  const csv = ['nome;telefone;ultima_interacao;dias_sem_falar;perfil;optin']
    .concat(linhas.map((c) => [
      escapar(c.nome), c.numero, c.ultima, c.dias === null ? '' : c.dias, '', 'sim',
    ].join(';')))
    .join('\n');
  fs.writeFileSync(saida, csv + '\n', 'utf8');

  const comConversa = linhas.filter((c) => c.dias !== null);
  const faixa = (min, max) => comConversa.filter((c) => c.dias >= min && c.dias <= max).length;

  console.log(`\n=== Exportados ${linhas.length} contatos ===`);
  console.log(`  Ate 90 dias .......... ${faixa(0, 90)}`);
  console.log(`  91 a 365 dias ........ ${faixa(91, 365)}`);
  console.log(`  Mais de 1 ano ........ ${faixa(366, 99999)}`);
  console.log(`  Sem data de conversa . ${linhas.length - comConversa.length}`);
  console.log(`\n  Arquivo: ${path.relative(RAIZ, saida)}`);
  console.log('  A coluna optin veio marcada "sim" porque sao contatos com historico');
  console.log('  neste numero. Revise antes de disparar.\n');

  try { await sock.ws?.close(); } catch { /* ja fechado */ }
  process.exit(0);
}

main().catch((erro) => {
  console.error(`\nErro no export: ${erro.message}\n`);
  process.exit(1);
});
