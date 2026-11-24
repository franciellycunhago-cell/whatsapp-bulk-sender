// A biblioteca de criptografia do WhatsApp (libsignal) escreve direto no
// console, sem passar pelo logger do Baileys, entao nao da para desligar pela
// configuracao. Num numero movimentado ela despeja centenas de linhas de chaves
// e sessoes por minuto, e o que importa ("[3/10] Fulano - enviado") some no meio.
//
// Nada disso e erro de verdade: sao mensagens antigas chegando cifradas com
// sessoes que este aparelho recem-conectado ainda nao conhece. O envio segue
// normal. Aqui a gente engole esse ruido e deixa o resto passar.
const PADROES = [
  /Session ?error/i,
  /Bad MAC/i,
  /Failed to decrypt/i,
  /Closing (open )?session/i,
  /Removing old closed session/i,
  /Removing session/i,
  /SessionEntry/,
  /No session record/i,
  /MessageCounterError/i,
  /Decrypted message with closed session/i,
];

function pareceRuido(args) {
  for (const arg of args) {
    if (typeof arg === 'string' && PADROES.some((p) => p.test(arg))) return true;
    if (arg instanceof Error && PADROES.some((p) => p.test(arg.message))) return true;
  }
  return false;
}

function silenciarRuidoDeCriptografia() {
  let engolidas = 0;

  for (const metodo of ['log', 'info', 'warn', 'error']) {
    const original = console[metodo].bind(console);
    console[metodo] = (...args) => {
      if (pareceRuido(args)) {
        engolidas++;
        return;
      }
      original(...args);
    };
  }

  return () => engolidas;
}

module.exports = { silenciarRuidoDeCriptografia };
