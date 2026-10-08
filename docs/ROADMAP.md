# Roadmap

O que falta, em ordem de valor. Junta a lista "Estado atual e próximos passos"
do [README](../README.md) com o que ficou em aberto na
[auditoria de 07/10/2026](auditoria/AUDITORIA-2026-10-07.md).

## 1. Fechar o protetor de tela no Windows

- Testar em Windows real o que só foi exercitado em Linux: `/s` em tela cheia,
  o diálogo `/c` (inclusive `/c:<janela>` vindo do painel) e o `.scr`
  empacotado com o Electron 44 (`npm run pack:scr`).
- Monitores com escalas diferentes: a janela única cobre a união dos
  retângulos em DIP; não verificado com 100 % + 150 % lado a lado.
- Instalador de clique único (electron-builder + NSIS) no lugar da pasta
  portátil.

## 2. Conteúdo

- Mais pincéis para os prodígios menos vistos (hoje alguns são silhuetas simples).
- Interior da caverna como um segundo cenário.
- Incêndio natural visível (hoje a história `o-incêndio` só existe na crônica).
- Furacão com visual próprio (hoje é um estado de clima com chuva e vento extremos).
- Constelações desenhadas (hoje há campo de estrelas, sem figuras).
- Animais migrando.

## 3. Imagem

- HDR de verdade (`display-p3`, canvas de ponto flutuante); hoje o pipeline é
  SDR com joelho suave no realce.
- Reflexo da ilha e das construções na água (hoje o mar reflete só o céu).
- Verificar em ultrawide (21:9, 32:9) e em 4K real.
- Terminar `docs/design/VISUAL_PIPELINE.md`, que parou no primeiro princípio.

## 4. Plataformas

- Linux e macOS: o núcleo já é portátil; falta o equivalente ao contrato `.scr`.
