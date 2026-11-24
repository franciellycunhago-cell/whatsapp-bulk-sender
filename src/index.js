#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const readline = require('node:readline/promises');

const { carregarContatos } = require('./contatos');
const { carregarVariacoes, criarSorteador, renderizar, validarVariacoes } = require('./mensagens');
const { abrirRegistro } = require('./registro');
const { criarConexao } = require('./conexao');
const { ligarEscuta } = require('./escuta');
const optout = require('./optout');
const { cotaDoDia, lerChip } = require('./aquecimento');
const { silenciarRuidoDeCriptografia } = require('./silencio');
const {
  esperar, segundosAleatorios, tempoDigitacao, dentroDaJanela,
  msAteAbrirJanela, formatarDuracao, estimarDuracao,
} = require('./ritmo');

const RAIZ = path.join(__dirname, '..');
const ruidoEngolido = silenciarRuidoDeCriptografia();
let pararPedido = false;

function lerArgumentos(argv) {
  const args = {
    campanha: null, dryRun: false, limite: null, perfil: null,
    semConfirmar: false, diario: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run' || a === '--teste') args.dryRun = true;
    else if (a === '--sim' || a === '-y') args.semConfirmar = true;
    else if (a === '--diario') args.diario = true;
    else if (a === '--limite') args.limite = parseInt(argv[++i], 10);
    else if (a === '--perfil') args.perfil = argv[++i];
    else if (a === '--campanha') args.campanha = argv[++i];
    else if (!a.startsWith('-') && !args.campanha) args.campanha = a;
  }
  return args;
}

function lerJson(caminho) {
  return JSON.parse(fs.readFileSync(caminho, 'utf8'));
}

function montarConfig(pastaCampanha, args) {
  const global = lerJson(path.join(RAIZ, 'config.json'));
  const arquivoCampanha = path.join(pastaCampanha, 'campanha.json');
  const local = fs.existsSync(arquivoCampanha) ? lerJson(arquivoCampanha) : {};

  return {
    ritmo: { ...global.ritmo, ...local.ritmo },
    janela: { ...global.janela, ...local.janela },
    seguranca: { ...global.seguranca, ...local.seguranca },
    aquecimento: { ...global.aquecimento, ...local.aquecimento },
    perfil: args.perfil || local.perfil || global.perfil || 'padrao',
    imagem: local.imagem || null,
  };
}

function listarCampanhas() {
  const pasta = path.join(RAIZ, 'campanhas');
  if (!fs.existsSync(pasta)) return [];
  return fs.readdirSync(pasta).filter((n) => fs.statSync(path.join(pasta, n)).isDirectory());
}

// Escada de volume: a campanha pode fixar o teto de cada data em
// ritmo.limitePorData ("AAAA-MM-DD": N). Sem entrada para hoje, vale o
// limiteDiario de sempre. Serve para deixar a subida programada de uma vez,
// em vez de editar o limite na mao todo dia de campanha.
function limiteDoDia(ritmo) {
  const hoje = new Date();
  const chave = [
    hoje.getFullYear(),
    String(hoje.getMonth() + 1).padStart(2, '0'),
    String(hoje.getDate()).padStart(2, '0'),
  ].join('-');
  const daData = (ritmo.limitePorData || {})[chave];
  return { limite: daData ?? ritmo.limiteDiario, daEscada: daData !== undefined };
}

async function confirmar(pergunta) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const resposta = (await rl.question(pergunta)).trim().toLowerCase();
  rl.close();
  return ['s', 'sim', 'y', 'yes'].includes(resposta);
}

// Espera que aceita Ctrl+C sem deixar o processo preso no timer.
async function esperarInterrompivel(ms, rotulo) {
  const fim = Date.now() + ms;
  if (ms > 15000 && rotulo) console.log(`  ${rotulo} (${formatarDuracao(ms)})`);
  while (Date.now() < fim && !pararPedido) {
    await esperar(Math.min(1000, fim - Date.now()));
  }
}

async function resolverJid(sock, contato, validar) {
  if (!validar) return `${contato.numero}@s.whatsapp.net`;

  let consultaFalhou = false;
  for (const candidato of contato.candidatos) {
    try {
      const resultado = await sock.onWhatsApp(candidato);
      // Resposta fora do formato esperado quer dizer que nao deu para
      // perguntar. Nao e a mesma coisa que o numero nao existir.
      if (!Array.isArray(resultado)) {
        consultaFalhou = true;
        continue;
      }
      const achado = resultado.find((r) => r && r.exists);
      if (achado && achado.jid) return achado.jid;
    } catch {
      consultaFalhou = true;
    }
  }

  // So afirma "nao tem WhatsApp" quando o WhatsApp respondeu que nao tem.
  // Com a conexao caida, onWhatsApp falha para todo mundo, e tratar isso como
  // numero inexistente fazia o disparo varrer a fila sem mandar nada: em
  // 23/10/2026 nove contatos foram marcados assim no mesmo segundo. Virando
  // erro, a protecao de falhas seguidas para o disparo como deve.
  if (consultaFalhou) {
    const erro = new Error('nao deu para verificar o numero (conexao caiu?)');
    erro.consultaFalhou = true;
    throw erro;
  }
  return null;
}

async function enviarMensagem(sock, jid, partes, config, caminhoImagem) {
  for (let i = 0; i < partes.length; i++) {
    const texto = partes[i];

    if (config.ritmo.simularDigitacao) {
      await sock.sendPresenceUpdate('composing', jid);
      await esperar(tempoDigitacao(texto));
      await sock.sendPresenceUpdate('paused', jid);
    }

    if (i === 0 && caminhoImagem) {
      await sock.sendMessage(jid, { image: fs.readFileSync(caminhoImagem), caption: texto });
    } else {
      await sock.sendMessage(jid, { text: texto });
    }

    if (i < partes.length - 1) await esperar(1500 + Math.random() * 2500);
  }
}

async function main() {
  const args = lerArgumentos(process.argv.slice(2));

  if (!args.campanha) {
    console.log('\nUso: npm start -- NOME-DA-CAMPANHA --perfil chip1 [--diario] [--dry-run] [--limite N]\n');
    const campanhas = listarCampanhas();
    console.log(campanhas.length
      ? `Campanhas disponiveis: ${campanhas.join(', ')}\n`
      : 'Nenhuma campanha criada ainda em campanhas/\n');
    process.exit(1);
  }

  const pastaCampanha = path.join(RAIZ, 'campanhas', args.campanha);
  if (!fs.existsSync(pastaCampanha)) {
    console.error(`\nCampanha "${args.campanha}" nao existe em campanhas/\n`);
    process.exit(1);
  }

  const config = montarConfig(pastaCampanha, args);
  const perfil = config.perfil;

  const { contatos, descartados, temColunaOptin, temColunaPerfil } = carregarContatos(
    path.join(pastaCampanha, 'contatos.csv'),
    { exigirOptin: config.seguranca.exigirOptin }
  );
  const variacoes = carregarVariacoes(path.join(pastaCampanha, 'mensagens'));
  const registro = abrirRegistro(pastaCampanha);
  const listaOptout = optout.carregar(RAIZ);

  const caminhoImagem = config.imagem ? path.join(pastaCampanha, config.imagem) : null;
  if (caminhoImagem && !fs.existsSync(caminhoImagem)) {
    console.error(`\nImagem configurada nao encontrada: ${caminhoImagem}\n`);
    process.exit(1);
  }

  // Cada chip so fala com a fatia dele. Sem coluna perfil, a base inteira e deste chip.
  const daFatia = temColunaPerfil
    ? contatos.filter((c) => !c.perfil || c.perfil === perfil)
    : contatos;
  const deOutroChip = contatos.length - daFatia.length;

  const semOptout = daFatia.filter((c) => !optout.estaNaListaDeSaida(listaOptout, c));
  const bloqueadosOptout = daFatia.length - semOptout.length;

  let fila = semOptout.filter((c) => !c.candidatos.some((n) => registro.jaEnviados.has(n)));
  const jaFeitos = semOptout.length - fila.length;

  // Teto do dia: cota do aquecimento (se --diario), limite da config e --limite.
  const { dia: diaDoChip, cota, chip } = cotaDoDia(RAIZ, perfil, config.aquecimento.curva);
  const enviadosHoje = registro.enviadosHoje(perfil);
  const { limite: limiteDeHoje, daEscada } = limiteDoDia(config.ritmo);
  const tetoConfigurado = args.diario
    ? Math.min(cota, limiteDeHoje)
    : limiteDeHoje;

  let teto = Math.max(0, tetoConfigurado - enviadosHoje);
  if (args.limite) teto = Math.min(teto, args.limite);
  if (fila.length > teto) fila = fila.slice(0, teto);

  const exemplo = contatos[0] || { campos: {}, nome: '', primeiroNome: '', bruto: '' };
  const problemas = validarVariacoes(variacoes, exemplo);

  console.log(`\n=== Campanha: ${args.campanha} | chip: ${chip?.apelido || perfil} ===`);
  console.log(`  Contatos no CSV .......... ${contatos.length}`);
  if (deOutroChip) console.log(`  De outros chips .......... ${deOutroChip} (nao e com este)`);
  if (descartados.length) {
    const motivos = [...new Set(descartados.map((d) => d.motivo))].join(', ');
    console.log(`  Descartados .............. ${descartados.length} (${motivos})`);
  }
  if (bloqueadosOptout) console.log(`  Pediram para sair ........ ${bloqueadosOptout} (bloqueados)`);
  if (jaFeitos) console.log(`  Ja receberam antes ....... ${jaFeitos} (pulados)`);
  if (args.diario) {
    console.log(`  Aquecimento .............. dia ${diaDoChip} do chip -> cota de ${cota}/dia`);
    if (!chip) console.log('    (chip sem ativacao registrada: tratado como dia 1)');
  }
  console.log(`  Enviados hoje por este ... ${enviadosHoje} de ${tetoConfigurado}`);
  if (daEscada) console.log('    (teto de hoje vem da escada em limitePorData)');
  console.log(`  Vao receber agora ........ ${fila.length}`);
  console.log(`  Versoes de mensagem ...... ${variacoes.length} (${variacoes.map((v) => v.nome).join(', ')})`);
  console.log(`  Intervalo entre envios ... ${config.ritmo.segundosMin}s a ${config.ritmo.segundosMax}s`);
  console.log(`  Lote ..................... ${config.ritmo.tamanhoLote} envios, depois ${config.ritmo.pausaLoteMinutos}min de pausa`);
  console.log(`  Janela ................... ${config.janela.horaInicio}h as ${config.janela.horaFim}h`);
  if (caminhoImagem) console.log(`  Imagem ................... ${config.imagem}`);
  console.log(`  Tempo estimado ........... ${formatarDuracao(estimarDuracao(fila.length, config.ritmo))}`);

  if (!temColunaOptin) {
    console.log('\n  Atencao: o CSV nao tem coluna "optin". Confirme que essa base autorizou receber mensagens.');
  }
  if (!temColunaPerfil && args.diario) {
    console.log('  Atencao: CSV sem coluna "perfil". Rode "npm run dividir" antes de usar varios chips.');
  }
  if (problemas.length) {
    console.log('\n  Problemas nas mensagens:');
    problemas.forEach((p) => console.log(`   - ${p}`));
  }

  if (fila.length === 0) {
    console.log('\nNada para enviar agora.\n');
    return;
  }

  console.log('\n--- Previa (3 primeiros) ---');
  const sorteadorPrevia = criarSorteador(variacoes);
  for (const contato of fila.slice(0, 3)) {
    const v = sorteadorPrevia();
    console.log(`\n[${contato.numero}] ${contato.nome || '(sem nome)'} | versao ${v.nome}`);
    renderizar(v.texto, contato).forEach((parte) => console.log(`  > ${parte.replace(/\n/g, '\n  > ')}`));
  }
  console.log('');

  if (args.dryRun) {
    console.log('Modo teste: nada foi enviado. Tire o --dry-run para disparar de verdade.\n');
    return;
  }

  if (!args.semConfirmar) {
    const ok = await confirmar(`Disparar para ${fila.length} contatos pelo chip "${perfil}"? (s/n) `);
    if (!ok) {
      console.log('Cancelado.\n');
      return;
    }
  }

  process.on('SIGINT', () => {
    if (pararPedido) process.exit(1);
    pararPedido = true;
    console.log('\n  Parando com seguranca... (Ctrl+C de novo forca a saida)');
  });

  // Rodando pelo agendador ninguem esta na frente da tela para ler o QR.
  const conexao = criarConexao(RAIZ, perfil, { timeoutMs: args.diario ? 120000 : null });
  let sock = await conexao.garantir();
  const escuta = ligarEscuta(sock, { raiz: RAIZ, perfil, listaOptout });

  const sortear = criarSorteador(variacoes);
  let enviados = 0, pulados = 0, falhas = 0, falhasSeguidas = 0, saiuNoMeio = 0;
  // Contado a parte de 'enviados': com 'enviados % lote', um envio que falha
  // deixa o contador parado e a pausa longa dispara de novo na volta,
  // custando 25 min por falha (visto em 23/10/2026).
  let desdeAPausa = 0;

  for (let i = 0; i < fila.length && !pararPedido; i++) {
    const contato = fila[i];

    // Alguem pode ter pedido para sair depois que a fila foi montada.
    if (optout.estaNaListaDeSaida(listaOptout, contato)) {
      saiuNoMeio++;
      registro.registrar({ perfil, numero: contato.numero, nome: contato.nome, versao: '', status: 'optout', detalhe: 'pediu para sair' });
      continue;
    }

    if (!dentroDaJanela(config.janela)) {
      if (args.diario) {
        console.log('\n  Fora da janela de envio. Encerrando a cota de hoje.');
        break;
      }
      const espera = msAteAbrirJanela(config.janela);
      console.log(`\n  Fora da janela de envio. Retoma em ${formatarDuracao(espera)}.`);
      await esperarInterrompivel(espera, 'Aguardando a janela abrir');
      if (pararPedido) break;
    }

    const versao = sortear();
    const partes = renderizar(versao.texto, contato);
    const etiqueta = `[${i + 1}/${fila.length}] ${contato.nome || contato.numero}`;

    try {
      // Pega sempre a conexao vigente. Ate 26/10/2026 o loop guardava o socket
      // da primeira conexao num const: quando a linha caia, a reconexao criava
      // um socket novo (a tela ate imprimia "Conectado como..."), mas o loop
      // seguia falando com o socket morto e TODO contato seguinte dava erro
      // ate a protecao de 5 falhas parar tudo. Era isso que matava o disparo
      // depois dos primeiros envios, nos tres dias de campanha.
      sock = await conexao.garantir();
      escuta.religar(sock);

      const jid = await resolverJid(sock, contato, config.seguranca.validarNumeroNoWhatsapp);

      if (!jid) {
        pulados++;
        registro.registrar({ perfil, numero: contato.numero, nome: contato.nome, versao: versao.nome, status: 'sem_whatsapp', detalhe: contato.bruto });
        console.log(`${etiqueta} - sem WhatsApp, pulado`);
        continue;
      }

      await enviarMensagem(sock, jid, partes, config, caminhoImagem);

      enviados++;
      desdeAPausa++;
      falhasSeguidas = 0;
      registro.registrar({ perfil, numero: contato.numero, nome: contato.nome, versao: versao.nome, status: 'enviado', detalhe: jid });
      console.log(`${etiqueta} - enviado (versao ${versao.nome})`);
    } catch (erro) {
      falhas++;
      falhasSeguidas++;
      registro.registrar({ perfil, numero: contato.numero, nome: contato.nome, versao: versao.nome, status: 'erro', detalhe: erro.message });
      console.log(`${etiqueta} - ERRO: ${erro.message}`);

      if (falhasSeguidas >= config.seguranca.pausarAposFalhasSeguidas) {
        console.log(`\n  ${falhasSeguidas} falhas seguidas. Parando para nao queimar o chip.`);
        console.log('  Confira o WhatsApp no celular antes de rodar de novo.\n');
        break;
      }

      conexao.invalidar();
      sock = await conexao.garantir().catch(() => sock);
      escuta.religar(sock);
    }

    if (i === fila.length - 1 || pararPedido) break;

    if (desdeAPausa >= config.ritmo.tamanhoLote) {
      desdeAPausa = 0;
      await esperarInterrompivel(
        config.ritmo.pausaLoteMinutos * 60 * 1000,
        `Lote de ${config.ritmo.tamanhoLote} concluido. Pausa longa`
      );
    } else {
      await esperarInterrompivel(segundosAleatorios(config.ritmo.segundosMin, config.ritmo.segundosMax) * 1000);
    }
  }

  // Um instante a mais para captar respostas que chegaram no fim da rodada.
  await esperar(5000);

  console.log('\n=== Fim ===');
  console.log(`  Enviados: ${enviados} | Sem WhatsApp: ${pulados} | Erros: ${falhas}`);
  if (saiuNoMeio) console.log(`  Sairam durante a rodada: ${saiuNoMeio}`);
  console.log(`  Respostas recebidas: ${escuta.respostas} | Pedidos de saida: ${escuta.saidas}`);
  console.log(`  Log: ${path.relative(RAIZ, registro.arquivo)}`);
  const ruido = ruidoEngolido();
  if (ruido) console.log(`  Avisos de criptografia ocultados: ${ruido} (normal, nao sao falhas de envio)`);
  console.log('');

  await conexao.encerrar();
  process.exit(0);
}

main().catch((erro) => {
  console.error(`\nErro: ${erro.message}\n`);
  process.exit(1);
});
