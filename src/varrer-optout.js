#!/usr/bin/env node
// Varre o historico do proprio WhatsApp procurando quem ja pediu para sair
// em campanhas anteriores, e alimenta o optout.csv global.
//
// Resolve o caso de uma campanha antiga cujos opt-outs ficaram registrados
// em outro lugar (uma VPS fora do ar, uma planilha perdida, a memoria do dono).
// A fonte da verdade passa a ser a conversa que esta no aparelho.
//
// Usa o mesmo criarConexao do disparo, que reconecta sozinho ate 3 vezes —
// a primeira conexao do Baileys cai com frequencia e precisa dessa retentativa.
//
// Este script NUNCA envia mensagem.
const path = require('path');

const { criarConexao } = require('./conexao');
const optout = require('./optout');
const { extrairTexto } = require('./escuta');

const RAIZ = path.join(__dirname, '..');

function lerArgumentos(argv) {
  const args = { perfil: 'padrao', espera: 180, desde: null, aplicar: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--perfil') args.perfil = argv[++i];
    else if (a === '--espera') args.espera = parseInt(argv[++i], 10);
    else if (a === '--desde') args.desde = argv[++i];        // AAAA-MM-DD
    else if (a === '--aplicar') args.aplicar = true;          // sem isso, so lista
  }
  return args;
}

function paraSegundos(valor) {
  if (!valor) return 0;
  if (typeof valor === 'number') return valor;
  if (typeof valor === 'string') return parseInt(valor, 10) || 0;
  if (typeof valor.toNumber === 'function') return valor.toNumber();
  if (typeof valor.low === 'number') return valor.low;
  return 0;
}

async function main() {
  const args = lerArgumentos(process.argv.slice(2));
  const limiteData = args.desde ? new Date(`${args.desde}T00:00:00`).getTime() / 1000 : 0;

  console.log('\n=== Varredura de opt-out no historico ===');
  console.log(`  Perfil ....... ${args.perfil}`);
  if (args.desde) console.log(`  A partir de .. ${args.desde}`);
  console.log(`  Modo ......... ${args.aplicar ? 'APLICAR (grava no optout.csv)' : 'somente listar'}`);
  console.log('  Este script nao envia nenhuma mensagem.');

  // NAO ligar historicoCompleto aqui: com syncFullHistory o WhatsApp fecha a
  // conexao com codigo 428 antes mesmo de emitir o QR (testado em 22/10/2026).
  // Sem ele o Baileys ainda entrega as conversas recentes, que e o que da pra ler.
  const conexao = criarConexao(RAIZ, args.perfil);
  const sock = await conexao.garantir();

  const achados = new Map(); // numero -> { texto, quando }
  let mensagensLidas = 0;
  let ultimoEvento = Date.now();

  function examinar(msg) {
    const jid = msg.key?.remoteJid || '';
    if (msg.key?.fromMe) return;
    if (!jid.endsWith('@s.whatsapp.net')) return;

    const quando = paraSegundos(msg.messageTimestamp);
    if (limiteData && quando && quando < limiteData) return;

    const texto = extrairTexto(msg.message);
    if (!texto) return;

    mensagensLidas++;
    if (!optout.ehPedidoDeSaida(texto)) return;

    const numero = optout.soDigitos(jid.split('@')[0]);
    const anterior = achados.get(numero);
    if (!anterior || quando > anterior.quando) {
      achados.set(numero, { texto, quando });
    }
  }

  sock.ev.on('messaging-history.set', ({ messages = [] }) => {
    for (const msg of messages) examinar(msg);
    ultimoEvento = Date.now();
    process.stdout.write(`\r  Lendo historico... ${mensagensLidas} mensagens, ${achados.size} pedidos de saida   `);
  });

  sock.ev.on('messages.upsert', ({ messages = [] }) => {
    for (const msg of messages) examinar(msg);
  });

  console.log('  Aguardando o historico (pode levar ate 3 minutos)...\n');

  const limite = Date.now() + args.espera * 1000;
  while (Date.now() < limite && Date.now() - ultimoEvento < 30000) {
    await new Promise((r) => setTimeout(r, 1000));
  }

  console.log(`\n\n=== ${achados.size} pessoas pediram para sair ===`);
  if (achados.size === 0) {
    console.log('  Nenhum pedido encontrado no historico lido.');
    console.log('  Vale conferir no celular antes de disparar.\n');
  } else {
    const listaAtual = optout.carregar(RAIZ);
    for (const [numero, { texto, quando }] of achados) {
      const data = quando ? new Date(quando * 1000).toISOString().slice(0, 10) : 'sem data';
      const novo = listaAtual.has(numero) ? '(ja estava na lista)' : '';
      console.log(`  ${numero}  ${data}  "${texto.slice(0, 50)}"  ${novo}`);

      if (args.aplicar && !listaAtual.has(numero)) {
        optout.registrar(RAIZ, { numero, perfil: args.perfil, origem: 'historico', mensagem: texto });
      }
    }

    console.log('');
    if (args.aplicar) console.log('  Gravados no optout.csv. Ninguem dessa lista entra em campanha nenhuma.\n');
    else console.log('  Nada foi gravado. Rode com --aplicar para bloquear essas pessoas.\n');
  }

  console.log(`  Mensagens recebidas analisadas: ${mensagensLidas}`);
  console.log('  Obs: o WhatsApp entrega o historico que o aparelho tem. Conversa');
  console.log('  apagada no celular do dono nao aparece aqui.\n');

  await conexao.encerrar();
  process.exit(0);
}

main().catch((erro) => {
  console.error(`\nErro na varredura: ${erro.message}\n`);
  process.exit(1);
});
