'use strict';

/**
 * Interpreta a linha de comando do protetor de tela do Windows.
 *
 * O contrato do `.scr`:
 *   /s            executar
 *   /c, /c:HWND   configurar (o painel do Windows manda a janela-mãe colada)
 *   /p HWND       miniatura na caixa de diálogo
 *   (nada)        configurar — é como o botão "Configurar" do Explorer chama
 *
 * "Sem argumentos = configurar" só vale para o `.scr` empacotado: rodando do
 * código (`npm run desktop`), sem argumentos é a janela comum.
 *
 * @param {string[]} userArgs argumentos depois do executável (e do script, fora do pacote)
 * @param {boolean} packaged `app.isPackaged`
 * @returns {'protetor' | 'config' | 'miniatura' | 'dev' | 'janela'}
 */
function parseMode(userArgs, packaged) {
  const args = userArgs.map((a) => String(a).toLowerCase());
  const has = (name) => args.some((a) =>
    a === `/${name}` || a.startsWith(`/${name}:`) || a === `-${name}` || a === `--${name}`);

  if (has('s')) return 'protetor';
  if (has('c')) return 'config';
  if (has('p')) return 'miniatura';
  if (has('dev')) return 'dev';
  // Chaves do Chromium/Electron (`--algo`) não contam como argumento do Windows.
  const windowsArgs = args.filter((a) => !a.startsWith('--'));
  if (packaged && windowsArgs.length === 0) return 'config';
  return 'janela';
}

module.exports = { parseMode };
