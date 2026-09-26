# Driftwood

Um sucessor espiritual dos protetores de tela contemplativos dos anos 90: um náufrago
vive sozinho numa ilha e não sabe que você existe.

Não é um jogo. Não há controle, não há objetivo, não há menu durante a execução.
Você observa. O mundo continua acontecendo quando ninguém está olhando.

**Nenhum ativo de terceiros.** Não existe um único arquivo de imagem, som ou fonte
neste projeto. Ilha, personagem, palmeiras, papagaio, sereia, oceano, chuva, mar,
vento e pássaros são gerados por código — geometria procedural, shaders e síntese
de áudio. A obra é inspirada no *conceito* do clássico, não em seus ativos.

---

## Rodar

```bash
npm install
npm run dev
```

Abra <http://localhost:5273>.

Checagens (as mesmas que o CI roda a cada push):

```bash
npm run typecheck
npm test        # determinismo por semente, save/load e emissão de partículas
npm run build
```

Parâmetros úteis de URL:

| Parâmetro | Efeito |
| --- | --- |
| `?novo` | apaga o mundo salvo e recomeça |
| `?semente=12345` | reconstrói exatamente a mesma ilha |

Versão desktop (Electron):

```bash
npm run desktop
```

> O Electron baixa um binário de ~190 MB no `postinstall`. Se o `npm install`
> tiver pulado os scripts, rode `npm approve-scripts electron` e confira que
> `node_modules/electron/dist/electron.exe` existe. Caso o `install.js` termine
> sem baixar o binário (deixa `dist/` quase vazio), baixe o zip da release
> correspondente e extraia sobre `node_modules/electron/dist`.
>
> **Estado:** a casca de desktop **abre e roda** (`npm run desktop:dev`). O que
> ainda não foi exercitado de ponta a ponta é o modo protetor de tela em si
> (`/s`, `/c`, `/p`) e o empacotamento como `.scr` — ver a seção final.

## Teclas

Só existem quatro, e nenhuma delas interfere no mundo.

| Tecla | Ação |
| --- | --- |
| `i` | informações discretas (dia, clima, impulso dominante, desempenho) |
| `f` | tela cheia |
| `m` | silenciar |
| `p` | pausar |

---

## O que acontece

O tempo corre a **2 minutos de mundo por segundo real** — um dia inteiro leva cerca
de 12 minutos. Um ano de mundo (quatro estações de 12 dias) leva cerca de 10 horas.

- **Céu:** nascer e pôr do sol, fases da lua com iluminação correta, estrelas com
  cintilação e faixa densa, constelações, sol e lua projetando luz sobre a água.
- **Clima:** oito estados com matriz de transição por estação, mais fenômenos
  raros — arco-íris (só quando a chuva está acabando com sol no céu), aurora
  (noites frias e limpas), meteoros, eclipse (só na lua nova).
- **Maré:** semidiurna com modulação lunar. Marés de sizígia na lua cheia e nova.
- **Ecologia:** palmeiras levam ~30 dias de mundo para crescer, dão frutos por
  estação, morrem em tempestade; a praia sofre erosão com vento forte e a areia
  volta na calmaria; construções se desgastam e viram ruína se ninguém consertar.

O náufrago tem dez impulsos internos (fome, sede, descanso, curiosidade, medo,
criatividade, preguiça, felicidade, solidão, esperança) e escolhe entre ~25 ações
por utilidade — cada ação se autoavalia, com ruído, inércia e recarga. Ele aprende
dez habilidades por prática, com retorno decrescente; envelhece, cria barba, muda
de roupa e de postura ao longo dos meses.

Sobre isso corre um **diretor narrativo** com histórias emergentes: começar uma
jangada, vê-la afundar, domesticar um papagaio, perdê-lo, achar uma caverna, um
mapa, uma garrafa. Nada é sequência fixa — são possibilidades com pré-condições,
pesos e recarga, sorteadas quando fazem sentido.

E há os **prodígios**, com probabilidades deliberadamente cruéis:

| Evento | Frequência aproximada |
| --- | --- |
| navio no horizonte | 1 a cada 22 dias de mundo (~4 h) |
| baleia | 1 a cada 55 dias |
| OVNI | 1 a cada 260 dias (~52 h) |
| sereia | 1 a cada 320 dias, e só na lua cheia |
| kraken | 1 a cada 700 dias, e só em tempestade |
| ilha flutuante | 1 a cada 800 dias |
| dragão adormecido | 1 a cada 2 600 dias, e só depois de achar a caverna |
| portal | 1 a cada 2 000 dias, e só durante uma aurora |

Algumas pessoas nunca vão ver certas coisas. É esse o ponto.

---

## Arquitetura

ECS de verdade (sparse-set, sem dependências), com estágios de execução fixos e
sistemas que não se conhecem. Detalhes em [docs/ARQUITETURA.md](docs/ARQUITETURA.md).

```
src/
  core/      ECS, eventos, RNG determinístico, matemática, configuração
  sim/       mundo, ilha, calendário, clima, maré, componentes, sistemas
  ai/        necessidades, catálogo de ações, IA de utilidade, habilidades
  story/     histórias emergentes, diretor, eventos raros
  render/    WebGL2: shader de céu/mar, pincel 2D em lote, pincéis procedurais,
             personagem articulado, partículas, câmera, paleta de luz
  audio/     ambiente sintetizado (WebAudio)
  persist/   serialização do mundo
electron/    casca de desktop e protetor de tela do Windows
```

Regras da casa:

1. Componentes são dados puros. Nenhum método, nenhuma referência a render.
2. Sistemas são funções sobre `World` + contexto. Um sistema nunca importa outro.
3. Comunicação entre sistemas: eventos ou componentes. Nunca chamada direta.
4. A ordem de execução vem dos estágios, nunca da ordem dos `import`.
5. Renderização não escreve no mundo. Simulação não conhece pixels.

---

## Como acrescentar conteúdo

**Uma ação nova** — `src/ai/actions.ts`. Diga quanto ela vale agora e o que faz:

```ts
{
  id: 'assobiar',
  pose: 'parado',
  duration: [400, 1200],
  cooldown: 6 * 3600,
  score: (c) => desire(c.needs.loneliness) * 0.6,
  onFinish: (c) => satisfy(c.needs, 'loneliness', 0.2),
}
```

Não há nada a registrar: o cérebro passa a considerá-la no próximo passo.

**Uma história nova** — `src/story/stories.ts`. Passos com `wait`, `until` ou
efeito imediato; `requires` e `bias` decidem quando ela pode acontecer. Para uma
obra ("ele resolveu construir X"), use o molde `projectStory`.

**Um prodígio novo** — `src/story/rareEvents.ts`, com `perDay` (frequência
esperada por dia de mundo) e uma condição dura em `requires`.

**Um desenho novo** — `src/render/brushes.ts` ou `creatures.ts`. Um pincel é uma
função pura que recebe posição, semente, luz e tempo, e emite triângulos.

---

## Desempenho

- Simulação em passo fixo de 20 Hz, com teto de recuperação para nunca entrar em
  espiral de morte.
- Sistemas caros (ecologia, diretor, envelhecimento) rodam a cada N passos.
- Corpos físicos dormem quando param.
- Partículas em arrays pré-alocados, buffer circular, zero alocação por quadro.
- Três níveis de qualidade com rebaixamento automático quando o quadro estoura o
  orçamento (partículas, oitavas do oceano, detalhe de vegetação).
- Teto de resolução interna: em 4K a imagem é renderizada um pouco abaixo e
  escalada, o que mantém a GPU fria em execuções de semanas.

O consumo típico em 1080p fica na casa de um punhado de milissegundos por quadro.
Com a janela em segundo plano, o áudio suspende e o relógio não acumula atraso.

## Persistência

Tudo continua: a árvore que estava crescendo continua crescendo, a cabana torta
continua torta, os destroços continuam na praia. O save guarda o ECS inteiro, o
relógio, o clima, a erosão do terreno, as bandeiras de história e o estado dos
geradores aleatórios — recarregar não sorteia um mundo diferente.

No navegador vai para `localStorage`; no desktop, para um arquivo JSON em
`%APPDATA%/driftwood`, escrito de forma atômica.

---

## Protetor de tela do Windows

`electron/main.cjs` já entende o contrato do Windows: `/s` executa, `/c` mostra a
caixa de configuração, `/p` sai em silêncio. Em modo protetor abre uma janela em
tela cheia por monitor e encerra ao primeiro movimento de mouse ou tecla.

Em modo protetor, **uma única janela** cobre todos os monitores (a união dos
retângulos de tela), então é um só mundo em todas as telas — não uma simulação
independente por monitor. O encerramento sai ao toque de tecla, clique ou ao
mover o mouse.

### Gerar e instalar o `.scr`

```bash
npm run pack:scr
```

Isso faz o build e monta `release/Driftwood/` — uma pasta portátil com
`Driftwood.scr` e todo o runtime ao lado (DLLs, `.pak`, `resources/app`). Um app
Electron **não** é um arquivo único: o `.scr` só roda com esses arquivos vizinhos,
então distribui-se a pasta inteira, não o `.scr` sozinho.

Para instalar como protetor de tela do Windows:

1. Copie a pasta `release/Driftwood` para um lugar fixo, ex. `C:\Program Files\Driftwood`.
2. Clique com o botão direito em `Driftwood.scr` → **Instalar** (ou **Configurar**).
   O Windows grava o **caminho completo** do `.scr` no registro
   (`HKCU\Control Panel\Desktop\SCRNSAVE.EXE`), então ele pode ficar em
   `Program Files` junto das DLLs — não precisa ir para `System32`.
3. **Testar** (no menu do botão direito) roda em tela cheia; qualquer tecla,
   clique ou movimento de mouse encerra.

Ainda **não exercitado de ponta a ponta**: o comportamento de `/s` em tela cheia
real e o diálogo `/c` na janela de configuração do Windows (o pacote em si já
roda, renderiza e salva — ver a auditoria). Um instalador de clique único
(electron-builder + NSIS) fica como passo de produção.

## Estado atual e próximos passos

Funcionando: ECS, tempo, clima, fenômenos, maré, ecologia, erosão, IA de utilidade,
habilidades, envelhecimento, diretor narrativo, eventos raros, render completo,
áudio sintetizado, persistência, casca desktop.

A fazer, em ordem de valor:

1. Instalador de clique único (electron-builder + NSIS) e teste de `/s` e `/c` em
   tela real. O pacote portátil `.scr` já é gerado por `npm run pack:scr` e roda.
2. Mais pincéis para os prodígios menos vistos (hoje alguns são silhuetas simples).
3. Interior da caverna como um segundo cenário.
4. HDR de verdade (`display-p3`, canvas de ponto flutuante) — hoje o pipeline é
   SDR com joelho suave no realce.
5. Linux e macOS: o núcleo já é portátil; falta o equivalente ao contrato `.scr`.
