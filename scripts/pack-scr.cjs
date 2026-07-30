'use strict';

/**
 * Empacota o Driftwood como protetor de tela portátil do Windows.
 *
 * Um `.scr` é apenas um `.exe` renomeado, mas um app Electron precisa das suas
 * DLLs, dos `.pak` e da pasta `resources/` ao lado do executável. Então o
 * resultado é uma PASTA (`release/Driftwood/`) com tudo junto, não um arquivo
 * solto. Para instalar: copiar a pasta inteira para um lugar fixo (ex.
 * `C:\Program Files\Driftwood`) e apontar o Windows para o `.scr` dentro dela.
 *
 * Não depende de nenhum download: reaproveita o binário do Electron que já está
 * em node_modules e o `dist/` gerado pelo build.
 */

const fs = require('node:fs');
const path = require('node:path');

const raiz = path.join(__dirname, '..');
const distEletron = path.join(raiz, 'node_modules', 'electron', 'dist');
const distApp = path.join(raiz, 'dist');
const out = path.join(raiz, 'release', 'Driftwood');
const appDir = path.join(out, 'resources', 'app');

function limpa(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

function copia(src, dest) {
  fs.cpSync(src, dest, { recursive: true });
}

function main() {
  if (!fs.existsSync(path.join(distEletron, 'electron.exe'))) {
    console.error('electron.exe não encontrado em node_modules/electron/dist.');
    console.error('Rode `npm install` e garanta o binário (ver README).');
    process.exit(1);
  }
  if (!fs.existsSync(path.join(distApp, 'index.html'))) {
    console.error('dist/index.html não encontrado. Rode `npm run build` antes.');
    process.exit(1);
  }

  console.log('limpando', path.relative(raiz, out));
  limpa(out);
  fs.mkdirSync(out, { recursive: true });

  // 1. Runtime do Electron (executável + DLLs + paks + recursos).
  console.log('copiando runtime do Electron (~268 MB)...');
  copia(distEletron, out);

  // 2. O app em resources/app — o Electron o prioriza sobre o default_app.asar.
  console.log('montando resources/app...');
  fs.mkdirSync(appDir, { recursive: true });
  copia(path.join(raiz, 'electron'), path.join(appDir, 'electron'));
  copia(distApp, path.join(appDir, 'dist'));

  const pkgOrig = JSON.parse(fs.readFileSync(path.join(raiz, 'package.json'), 'utf8'));
  const pkgApp = {
    name: 'driftwood',
    productName: 'Driftwood',
    version: pkgOrig.version,
    main: 'electron/main.cjs',
  };
  fs.writeFileSync(path.join(appDir, 'package.json'), JSON.stringify(pkgApp, null, 2));

  // 3. electron.exe -> Driftwood.scr. É o passo que o torna um protetor de tela.
  fs.renameSync(path.join(out, 'electron.exe'), path.join(out, 'Driftwood.scr'));

  console.log('\npronto:', path.relative(raiz, path.join(out, 'Driftwood.scr')));
  console.log('Instalar: copie a pasta', path.relative(raiz, out), 'inteira para um');
  console.log('local fixo e crie um atalho para Driftwood.scr, ou rode-o com /s.');
}

main();
