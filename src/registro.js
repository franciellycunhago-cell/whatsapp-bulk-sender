const fs = require('fs');
const path = require('path');

const COLUNAS = ['data_hora', 'perfil', 'numero', 'nome', 'versao', 'status', 'detalhe'];
const CABECALHO = COLUNAS.join(';') + '\n';

function caminhoLog(pastaCampanha) {
  return path.join(pastaCampanha, 'envios.csv');
}

function escapar(valor) {
  return String(valor ?? '').replace(/[;\r\n]+/g, ' ').trim();
}

// Horario de Brasilia, nao UTC: o log e lido por pessoa, e um envio das 8h
// da manha nao pode aparecer como 11h.
function agoraLocal() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

const hoje = () => agoraLocal().slice(0, 10);

// Le um envios.csv e alimenta o que for pedido: a lista de quem ja recebeu
// (jaEnviados) e/ou a contagem por dia e perfil (porDiaPerfil).
function lerLog(arquivo, { jaEnviados, porDiaPerfil }) {
  if (!fs.existsSync(arquivo)) return;

  const linhas = fs.readFileSync(arquivo, 'utf8').split(/\r?\n/);
  // Le pelo cabecalho para aguentar logs gravados antes da coluna "perfil" existir.
  const colunas = (linhas[0] || '').split(';').map((c) => c.trim());
  const idx = Object.fromEntries(COLUNAS.map((c) => [c, colunas.indexOf(c)]));

  for (const linha of linhas.slice(1)) {
    if (!linha.trim()) continue;
    const campos = linha.split(';');
    const status = idx.status >= 0 ? campos[idx.status] : null;
    // Numero sem conta no WhatsApp nao e um envio, mas tambem nao adianta
    // tentar de novo: ate 02/11/2026 so "enviado" marcava o contato como
    // tratado, entao esses numeros voltavam para a fila todo dia e gastavam
    // vaga de quem receberia. Erro de conexao continua voltando, esse sim
    // merece nova tentativa.
    if (status !== 'enviado' && status !== 'sem_whatsapp') continue;

    if (jaEnviados) {
      const numero = idx.numero >= 0 ? campos[idx.numero] : null;
      if (numero) jaEnviados.add(numero);
    }

    // A cota do dia conta so o que saiu de verdade.
    if (porDiaPerfil && status === 'enviado') {
      const dia = (idx.data_hora >= 0 ? campos[idx.data_hora] || '' : '').slice(0, 10);
      const perfil = idx.perfil >= 0 ? campos[idx.perfil] || '' : '';
      const chave = `${dia}|${perfil}`;
      porDiaPerfil.set(chave, (porDiaPerfil.get(chave) || 0) + 1);
    }
  }
}

function abrirRegistro(pastaCampanha) {
  const arquivo = caminhoLog(pastaCampanha);
  if (!fs.existsSync(arquivo)) fs.writeFileSync(arquivo, CABECALHO, 'utf8');

  // Quem ja recebeu: so desta campanha. A mesma pessoa pode entrar em outra
  // campanha depois, e deve receber a mensagem dessa outra.
  const jaEnviados = new Set();
  lerLog(arquivo, { jaEnviados });

  // Cota do dia: de TODAS as campanhas. A cota existe para proteger o numero
  // do WhatsApp, e o numero e o mesmo nao importa em que campanha ele esteja.
  // Contar so a campanha atual deixava o chip levar o dobro sem avisar.
  const porDiaPerfil = new Map(); // "AAAA-MM-DD|perfil" -> quantidade
  const pastaCampanhas = path.dirname(pastaCampanha);
  for (const sub of fs.readdirSync(pastaCampanhas, { withFileTypes: true })) {
    if (!sub.isDirectory()) continue;
    lerLog(path.join(pastaCampanhas, sub.name, 'envios.csv'), { porDiaPerfil });
  }

  return {
    arquivo,
    jaEnviados,

    // Quantos ja sairam hoje por este chip, somando todas as campanhas.
    // Sem perfil informado, soma todos os chips.
    enviadosHoje(perfil) {
      if (perfil) return porDiaPerfil.get(`${hoje()}|${perfil}`) || 0;
      let total = 0;
      for (const [chave, qtd] of porDiaPerfil) {
        if (chave.startsWith(`${hoje()}|`)) total += qtd;
      }
      return total;
    },

    // Detalhe do que ja saiu hoje por chip, para o resumo da partida.
    detalhadoHoje(perfil) {
      return { perfil, enviados: this.enviadosHoje(perfil), dia: hoje() };
    },

    registrar({ perfil, numero, nome, versao, status, detalhe }) {
      const linha = [agoraLocal(), perfil, numero, nome, versao, status, detalhe]
        .map(escapar)
        .join(';');
      fs.appendFileSync(this.arquivo, linha + '\n', 'utf8');

      if (status === 'enviado') {
        jaEnviados.add(String(numero));
        const chave = `${hoje()}|${perfil || ''}`;
        porDiaPerfil.set(chave, (porDiaPerfil.get(chave) || 0) + 1);
      }
    },
  };
}

module.exports = { abrirRegistro };
