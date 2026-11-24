const fs = require('fs');
const path = require('path');
const { pastaSessao } = require('./conexao');

const raiz = path.join(__dirname, '..');
const perfil = process.argv[2] || require(path.join(raiz, 'config.json')).perfil || 'padrao';
const caminho = pastaSessao(raiz, perfil);

if (fs.existsSync(caminho)) {
  fs.rmSync(caminho, { recursive: true, force: true });
  console.log(`Sessao "${perfil}" apagada. No proximo disparo vai pedir o QR de novo.`);
} else {
  console.log(`Nao existe sessao salva com o perfil "${perfil}".`);
}
