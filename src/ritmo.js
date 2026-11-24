const esperar = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function segundosAleatorios(min, max) {
  if (max < min) [min, max] = [max, min];
  return min + Math.random() * (max - min);
}

// Tempo "digitando" proporcional ao tamanho do texto, com teto de 9s.
function tempoDigitacao(texto) {
  return Math.min(1200 + texto.length * 55, 9000);
}

function dentroDaJanela(janela, agora = new Date()) {
  const dia = agora.getDay();
  const hora = agora.getHours() + agora.getMinutes() / 60;
  const diaOk = !janela.diasSemana || janela.diasSemana.includes(dia);
  const horaOk = hora >= janela.horaInicio && hora < janela.horaFim;
  return diaOk && horaOk;
}

function msAteAbrirJanela(janela, agora = new Date()) {
  const alvo = new Date(agora);
  alvo.setSeconds(0, 0);
  for (let i = 0; i < 14; i++) {
    const candidato = new Date(alvo);
    candidato.setDate(alvo.getDate() + i);
    candidato.setHours(Math.floor(janela.horaInicio), Math.round((janela.horaInicio % 1) * 60), 0, 0);
    const diaOk = !janela.diasSemana || janela.diasSemana.includes(candidato.getDay());
    if (diaOk && candidato > agora) return candidato - agora;
  }
  return 60 * 60 * 1000;
}

function formatarDuracao(ms) {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const r = s % 60;
  if (m < 60) return r ? `${m}min ${r}s` : `${m}min`;
  return `${Math.floor(m / 60)}h ${m % 60}min`;
}

// Estimativa de quanto tempo a fila inteira vai levar, so pra avisar antes de comecar.
function estimarDuracao(quantidade, ritmo) {
  if (quantidade <= 1) return 0;
  const mediaEnvio = ((ritmo.segundosMin + ritmo.segundosMax) / 2) * 1000;
  const pausas = Math.floor((quantidade - 1) / ritmo.tamanhoLote);
  return (quantidade - 1) * mediaEnvio + pausas * ritmo.pausaLoteMinutos * 60 * 1000;
}

module.exports = {
  esperar,
  segundosAleatorios,
  tempoDigitacao,
  dentroDaJanela,
  msAteAbrirJanela,
  formatarDuracao,
  estimarDuracao,
};
