'use strict';

/**
 * Casca de desktop do Driftwood.
 *
 * Roda em dois modos:
 *   - janela normal (`npm run desktop`), útil para desenvolvimento e para
 *     deixar o programa aberto num monitor secundário;
 *   - protetor de tela do Windows: um `.scr` é apenas um executável que
 *     responde aos argumentos /s (executar), /c (configurar) e /p (miniatura).
 *
 * Em modo protetor de tela, qualquer movimento de mouse ou tecla encerra —
 * é o contrato do Windows, e o mundo é salvo antes de sair.
 */

const { app, BrowserWindow, ipcMain, screen, dialog, protocol, net } = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');
const { pathToFileURL } = require('node:url');

// O bundle do Vite é um módulo ES (`<script type="module">`), e o Chromium
// recusa módulos servidos por `file://`. Para a versão empacotada carregar, o
// `dist/` é servido por um esquema próprio com origem segura — assim os módulos
// carregam e o WebGL roda como numa página http normal, sem abrir porta.
protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);
const APP_URL = 'app://driftwood/index.html';

// Sem isto, rodando fora de um .exe empacotado o Electron chama o app de
// "Electron" e o save vai parar em %APPDATA%/Electron. Fixar o nome garante que
// o mundo fique sempre em %APPDATA%/driftwood, empacotado ou não.
app.setName('driftwood');

const args = process.argv.slice(1).map((a) => a.toLowerCase());
const flag = (name) => args.some((a) => a === `/${name}` || a === `-${name}` || a === `--${name}`);

const MODE = flag('s') ? 'protetor'
  : flag('c') ? 'config'
  : flag('p') ? 'miniatura'
  : flag('dev') ? 'dev'
  : 'janela';

const DEV_SERVER = 'http://localhost:5273';
// Carrega do dev server SÓ quando pedido explicitamente com --dev. Antes isto
// era `|| !app.isPackaged`, o que fazia `npm run desktop` (rodado do código, não
// de um .exe empacotado) tentar o dev server mesmo depois de ter feito o build —
// a janela abria em branco porque o Vite não estava no ar. Modo `dev` = servidor;
// todo o resto (janela, protetor, .scr empacotado) = `dist/`.
const isDev = MODE === 'dev';

let windows = [];

/** Estado fica em %APPDATA%/driftwood/mundo.json — sobrevive a atualizações. */
function savePath(key) {
  return path.join(app.getPath('userData'), `${key.replace(/[^a-z0-9.-]/gi, '_')}.json`);
}

ipcMain.handle('driftwood:save', async (_ev, key, value) => {
  await fs.mkdir(app.getPath('userData'), { recursive: true });
  // Escrita atômica: um desligamento no meio não corrompe o mundo.
  const target = savePath(key);
  const tmp = `${target}.tmp`;
  await fs.writeFile(tmp, value, 'utf8');
  await fs.rename(tmp, target);
});

ipcMain.handle('driftwood:load', async (_ev, key) => {
  try {
    return await fs.readFile(savePath(key), 'utf8');
  } catch {
    return null;
  }
});

ipcMain.handle('driftwood:clear', async (_ev, key) => {
  await fs.rm(savePath(key), { force: true });
});

ipcMain.handle('driftwood:sair', () => app.quit());

/**
 * Retângulo que cobre todos os monitores de uma vez. É a chave do modo protetor
 * de tela: uma janela só, esticada por tudo, mostrando UM mundo. A tentativa
 * anterior — uma janela por monitor — abria uma simulação independente em cada
 * tela, e elas divergiam em segundos apesar de partirem da mesma semente.
 */
function unionBounds() {
  const all = screen.getAllDisplays().map((d) => d.bounds);
  const x = Math.min(...all.map((b) => b.x));
  const y = Math.min(...all.map((b) => b.y));
  const right = Math.max(...all.map((b) => b.x + b.width));
  const bottom = Math.max(...all.map((b) => b.y + b.height));
  return { x, y, width: right - x, height: bottom - y };
}

function baseWebPreferences() {
  return {
    preload: path.join(__dirname, 'preload.cjs'),
    contextIsolation: true,
    nodeIntegration: false,
    backgroundThrottling: false,
    // Sem isso, o Windows suspende o WebGL quando a janela some — e o
    // programa precisa continuar vivo por semanas.
    additionalArguments: [`--driftwood-mode=${MODE}`],
  };
}

function load(win) {
  win.once('ready-to-show', () => win.show());
  win.loadURL(isDev ? DEV_SERVER : APP_URL);
}

/** Janela comum de desktop, com moldura. */
function createDesktopWindow() {
  const win = new BrowserWindow({
    width: 1600,
    height: 900,
    backgroundColor: '#05070d',
    autoHideMenuBar: true,
    show: false,
    title: 'Driftwood',
    webPreferences: baseWebPreferences(),
  });
  load(win);
  return win;
}

/** Janela única de protetor de tela, cobrindo todos os monitores. */
function createScreensaverWindow() {
  const rect = unionBounds();
  const win = new BrowserWindow({
    ...rect,
    frame: false,
    // `simpleFullscreen`/`kiosk` prendem a janela a um monitor só; para cobrir
    // vários, usa-se uma janela sem moldura, sempre no topo, com os limites da
    // união dos monitores.
    alwaysOnTop: true,
    skipTaskbar: true,
    backgroundColor: '#05070d',
    show: false,
    title: 'Driftwood',
    webPreferences: baseWebPreferences(),
  });
  win.setMenu(null);
  win.setBounds(rect); // reforça o tamanho após a criação
  load(win);

  // ── contrato do protetor de tela: sair ao primeiro sinal do usuário ──
  let armed = false;
  // Ignora o primeiro instante: abrir o protetor costuma vir com um movimento
  // residual de mouse que o encerraria na hora.
  setTimeout(() => { armed = true; }, 1200);
  const quit = () => { if (armed) app.quit(); };

  // Teclado e clique: chegam como before-input-event.
  win.webContents.on('before-input-event', quit);
  // Movimento do mouse: o Electron não tem evento global, então acompanha-se o
  // cursor. Sai assim que ele anda além de um limiar da posição inicial.
  const origin = screen.getCursorScreenPoint();
  const cursorTimer = setInterval(() => {
    if (!armed) return;
    const p = screen.getCursorScreenPoint();
    if (Math.abs(p.x - origin.x) > 8 || Math.abs(p.y - origin.y) > 8) quit();
  }, 250);
  win.on('closed', () => clearInterval(cursorTimer));

  return win;
}

app.on('window-all-closed', () => app.quit());

app.whenReady().then(() => {
  // Serve o dist/ pelo esquema app:// (usado quando não é modo dev).
  const distDir = path.join(__dirname, '..', 'dist');
  protocol.handle('app', (request) => {
    let rel = decodeURIComponent(new URL(request.url).pathname);
    if (rel === '/' || rel === '') rel = '/index.html';
    const target = path.join(distDir, rel);
    // Não deixa sair de dist/ (defesa contra ../ no caminho).
    if (!target.startsWith(distDir)) return new Response('', { status: 403 });
    return net.fetch(pathToFileURL(target).toString());
  });

  if (MODE === 'miniatura') {
    // A miniatura da caixa de diálogo do Windows exige incorporar-se numa
    // janela alheia; não vale a pena. Sai em silêncio, como manda o costume.
    app.quit();
    return;
  }

  if (MODE === 'config') {
    dialog.showMessageBoxSync({
      type: 'info',
      title: 'Driftwood',
      message: 'Driftwood não tem configuração.',
      detail:
        'A ilha se ajusta sozinha ao monitor e à máquina.\n\n' +
        'Durante a execução:\n' +
        '  i — informações discretas\n' +
        '  f — tela cheia\n' +
        '  m — silenciar\n' +
        '  p — pausar\n\n' +
        'O mundo é salvo automaticamente e continua de onde parou.',
      buttons: ['Fechar'],
    });
    app.quit();
    return;
  }

  // Um mundo, um processo. No modo protetor, uma única janela cobre todas as
  // telas; no modo normal, uma janela de desktop comum.
  windows = MODE === 'protetor'
    ? [createScreensaverWindow()]
    : [createDesktopWindow()];
});
