# Auditoria do Driftwood — 07/10/2026

Segunda auditoria do projeto, feita sobre o commit `ab7575b` (branch
`claude/awesome-volta-upir04`). A primeira, de 29/07/2026, está em
[`AUDITORIA.md`](../../AUDITORIA.md); esta não a substitui, mas ela ficou
desatualizada em vários pontos (seção 6).

**Método**

- leitura de todo o código em `src/`, `electron/` e `scripts/`, e da documentação;
- `npm ci`, `tsc --noEmit`, `vite build` e `npm audit` (Node 22.22, npm 10.9);
- **simulação headless** de 120 e 360 dias de mundo, com três sementes
  (771203, 424242, 90210), com o script
  [`scripts/auditoria/sim-headless.ts`](../../scripts/auditoria/sim-headless.ts),
  incluído no repositório para que todo número abaixo possa ser reproduzido:

  ```bash
  npx esbuild scripts/auditoria/sim-headless.ts --bundle --platform=node \
    --format=esm --outfile=/tmp/sim.mjs && node /tmp/sim.mjs 771203 360
  ```

**Não verificado aqui:** o render (não havia GPU/navegador no ambiente) e
qualquer coisa que dependa do Windows (`.scr`, `/s`, `/c`, `%APPDATA%`). Os
achados sobre essas partes vêm da leitura do código e estão marcados como tal.

Nenhum código do jogo foi alterado. Esta auditoria só acrescenta este documento,
o script headless e uma nota no topo de `AUDITORIA.md`.

---

## Situação depois das correções (mesmo dia)

As correções estão na branch `claude/awesome-volta-upir04`, que inclui também a
branch `claude/sleepy-pasteur-ki45mo` (build consertado, Vitest e CI). As
seções abaixo mantêm o achado original.

| # | Situação | Como foi verificado |
| --- | --- | --- |
| A1 | ✅ corrigido (na branch de testes) | `npm run build` passa |
| A2 | ✅ obras podem ser refeitas depois de destruídas | `test/obras.test.ts`; 360 dias: fogueira presente em todas as amostras |
| A3 | ✅ `narrate()` registra e emite | `test/chronicle.test.ts`; 360 dias: 0 de 1 059 linhas fora da tela |
| A4 | ✅ Electron 44.7, Vite 8, Vitest 5 | `npm audit`: 0 vulnerabilidades |
| M1 | ✅ anúncio na passagem de "nenhum" para um fenômeno | 360 dias: 34 fenômenos, 34 anúncios |
| M2 | ✅ `parseSeed` | `test/save-robustez.test.ts` |
| M3 | ✅ teto de 24 esculturas e 40 plantas | `test/longo.test.ts`; 360 dias: ~100 entidades estáveis (antes 256 e subindo) |
| M4 | ✅ desfecho sorteado uma vez; sem `CBody` depois; consertar ignora destroços e rochedos | `test/longo.test.ts` |
| M5 | ✅ `Renderer.restoreGpu` | Chromium headless com `WEBGL_lose_context` |
| M6 | ✅ fechar espera `__driftwoodFlush` | Electron em Linux (Xvfb + Playwright) |
| M7 | ✅ `electron/args.cjs` + instância única + clique encerra | `test/electron-args.test.ts` e Electron em Linux |
| M8 | ✅ save inutilizável é copiado para `….rejeitado`; falha ao aplicar recomeça | `test/save-robustez.test.ts` |
| M9 | ✅ Vitest + CI (na branch de testes) | — |
| B1 | ✅ `path.relative` | Electron em Linux: 403 |
| B3 | ✅ condição de despertar corrigida | — |
| B6 | ✅ HUD mostra as duas vagas | — |
| D4, D5, D6, B2, B4, B5, B7, B8 e documentação | em aberto | — |

**Não verificado no Windows:** `/s` em tela cheia real, o diálogo `/c`, e o
`.scr` empacotado com Electron 44. O roteiro de ponta a ponta rodou no Electron
44 em Linux.

---

## Resumo

| # | Severidade | Achado | Verificado |
| --- | --- | --- | --- |
| A1 | **Alta** | `npm run build` está quebrado: erro de tipo em `src/art/assets/registry.ts` | executado |
| A2 | **Alta** | Construções que se desgastam **nunca voltam**: a fogueira some antes do dia 60, e com ela fogo, cozinha e brasas | executado |
| A3 | **Alta** | **1/3 da crônica nunca aparece na tela**, incluindo todos os eventos raros | executado |
| A4 | **Alta** | Electron 33 fora de suporte, com ~38 alertas; 11 vulnerabilidades no total | `npm audit` |
| M1 | Média | Todo fenômeno do céu é anunciado **duas vezes** na crônica | executado |
| M2 | Média | `?semente=abc` reabre o defeito D7 (entidades fora do terreno) | executado em parte |
| M3 | Média | Crescimento sem teto de esculturas e plantas | executado |
| M4 | Média | A jangada afundada sai boiando para `x ≈ 1 358` e continua sendo alvo de conserto | executado |
| M5 | Média | Sem recuperação de perda de contexto WebGL: tela preta definitiva num protetor de tela | leitura |
| M6 | Média | Sair do protetor de tela não garante o salvamento | leitura |
| M7 | Média | Argumentos do Windows `/c:HWND` e "sem argumento" abrem a janela comum | leitura |
| M8 | Média | Save de outra versão é descartado em silêncio; save corrompido trava o boot para sempre | leitura |
| M9 | Média | Nenhum teste, CI ou lint | — |
| B1–B8 | Baixa | Filtro de caminho do `app://`, CSP, instância única, física, determinismo pós-carga, código morto… | ver seção 4 |

O que está bom e foi confirmado: a simulação é estável (0 `NaN` em 360 dias,
três sementes), barata (0,015–0,04 ms por passo) e o *round-trip* do save
preserva todas as entidades. A casca Electron usa `contextIsolation`, sem
`nodeIntegration`, grava de forma atômica e sanitiza a chave do arquivo.

---

## 1. Achados de severidade alta

### A1 — O build de produção não passa

```
$ npx tsc --noEmit
src/art/assets/registry.ts(99,7): error TS2322: Type '"light"' is not assignable to type 'AssetLayer'.
$ npm run build   # → exit 2
```

O commit `ab7575b` ("Adicionar sistema inicial de assets visuais") declara
`camp_fire.layers` com `"light"`, que não existe no tipo `AssetLayer`. Como
`build` é `tsc --noEmit && vite build`, **`npm run build`, `npm run desktop` e
`npm run pack:scr` estão todos quebrados**. O `vite build` sozinho passa (não
checa tipos), o que esconde o problema de quem só roda o servidor de
desenvolvimento.

Além disso, `registry.ts` não é importado por nenhum arquivo: é código morto que,
hoje, só serve para quebrar o build.

**Correção:** acrescentar `"light"` ao `AssetLayer` (ou tirá-lo da fogueira) e,
de qualquer forma, decidir se o registro entra no renderer ou sai do `src/`
enquanto o ADR-001 estiver como "Proposta".

### A2 — O mundo perde as construções para sempre

Todas as obras usam o molde `projectStory` (`src/story/stories.ts:62`), que é
`once: true`. Ao mesmo tempo, `ecologySystem` desgasta toda construção pronta e
a destrói quando `condition` chega a 0 (`src/sim/systems.ts:156`). Uma obra
destruída nunca pode ser refeita, porque a bandeira `história-feita:<id>`
continua ligada.

Medido (semente 771203):

| Dia | Construções presentes (além de esculturas e destroços) |
| --- | --- |
| 60 | horta, cadeira, cabana, tambor, telescópio, baú, cavalete, rede, escada, moinho, observatório, ponte — **e nenhuma fogueira** |
| 180 | horta, tambor, telescópio, baú, cavalete, rede, moinho, observatório |
| 360 | tambor, baú, rede, observatório |

A fogueira já tinha sido destruída ("fogueira não resistiu.") antes do dia 60.
A partir daí `acender-fogueira`, `cozinhar` e as brasas não podem mais
acontecer — o que anula, no longo prazo, a correção D8 da auditoria anterior,
que só foi medida em 34 dias. Num programa feito para ficar aberto por meses,
a ilha esvazia: no fim de um ano de mundo (~10 h reais) só sobram esculturas e
destroços.

**Correção:** para obras, trocar `once` por "existe agora?" (`requires:
!hasProp`, que já existe) mais uma recarga; ou fazer a ruína não destruir a
obra e sim deixá-la como "ruína" que pode ser reconstruída.

### A3 — Um terço da crônica nunca chega à tela

A crônica na tela (`src/main.ts:88`) só mostra o que passa pelo evento
`crônica`. Só duas funções emitem esse evento: `say()` nas ações e `enterStep()`
no diretor. Todas as outras escrevem direto em `ws.chronicle` com `chronicle()`,
sem emitir nada:

- `rollRareEvents` (`src/story/rareEvents.ts:292`) — **todos os 17 eventos raros**;
- `timeSystem` — início de estação e fenômenos do céu;
- `ecologySystem` — ruínas e o castelo de areia levado pela maré;
- `agingSystem` — troca de roupa e "30 dias.";
- `genesis` — a primeira linha do mundo.

Medido em 360 dias: **433 de 1 327 linhas (33 %) foram registradas e nunca
exibidas**. Exemplos: "Um navio cruzou o horizonte. Longe. Muito longe.", "Uma
baleia soprou perto demais da arrebentação.", "Começou o verão.". O momento mais
raro do programa — o prodígio que "algumas pessoas nunca vão ver" — acontece
sem uma linha de texto. Elas só reaparecem se forem uma das duas últimas linhas
salvas quando a página recarrega.

**Correção:** `chronicle()` emitir o evento (ela não recebe o `bus`; dá para
passar o `bus` ou fazer `main.ts` observar o crescimento de `ws.chronicle`).

### A4 — Dependências vulneráveis

`npm audit`: **11 vulnerabilidades (6 altas, 5 moderadas)**.

- **`electron@33.4.11`** — fora de suporte, com ~38 alertas (bypass de ASAR,
  use-after-free, bypass de isolamento de contexto via `Function.prototype.bind`,
  handlers de protocolo que permitem leitura entre origens, entre outros). É o
  ponto mais importante, porque o `.scr` **distribui** esse runtime. A correção
  pede uma atualização de versão maior (`electron@44`).
- `vite@5` / `esbuild@0.21` — o dev server responde a requisições de qualquer
  site (moderada; só afeta quem roda `npm run dev`).
- `source-map-js`, `extract-zip`, `sprintf-js`/`global-agent` (dentro de
  `@electron/get`) — ferramentas de build; `npm audit fix` resolve parte sem
  quebrar.

---

## 2. Achados de severidade média

### M1 — Fenômenos anunciados em dobro

`timeSystem` anuncia o fenômeno quando `phenomenonTime <= worldDt`
(`src/sim/systems.ts:43`). Isso é verdade no passo em que o fenômeno começa
(`phenomenonTime = 0`) **e** no passo seguinte (`phenomenonTime = worldDt`
exato, porque o mesmo `dt` é somado). Resultado: dois eventos `fenômeno` e duas
linhas iguais na crônica para cada aurora, arco-íris, eclipse ou chuva de
meteoros.

Medido: fenômenos iniciados × eventos emitidos = 7 × 14, 9 × 18 e 15 × 30 nas três
sementes. Em 120 dias, 28 a 33 pares de linhas consecutivas duplicadas, a
maioria "Riscos de luz atravessaram o céu a noite inteira.".

**Correção:** anunciar dentro de `begin()` ou usar `phenomenonTime === 0`.

### M2 — `?semente=` inválida reabre o D7

`main.ts:35` faz `Number(params.get('semente'))` sem validar. `?semente=abc` dá
`NaN`, que (a) não é igual à semente do save, então o save é **descartado**; e
(b) é gravado como `null` no JSON (`JSON.stringify({s: NaN})` → `{"s":null}`).
No próximo carregamento sem parâmetro, `savedSeed()` não encontra número e
**sorteia uma semente nova**: a ilha muda e as entidades salvas ficam no ar ou
enterradas — exatamente o defeito D7 que a auditoria anterior deu como
corrigido. `?semente=` vazio vira a semente 0 sem aviso.

**Correção:** aceitar só `Number.isSafeInteger(n) && n >= 0`; no mais, ignorar
o parâmetro com um aviso.

### M3 — Crescimento sem teto

| Dia | Entidades | Plantas | Esculturas | ms por passo |
| --: | --: | --: | --: | --: |
| 0 | 27 | — | 0 | — |
| 60 | 94 | 27 | 22 | 0,015 |
| 180 | 215 | 77 | 75 | 0,025 |
| 360 | 256 | 122 | 102 | 0,027–0,041 |

`esculpir` cria uma escultura nova a cada vez (`src/ai/actions.ts:428`), e
`plantar` não tem teto. Em um ano de mundo são ~100 esculturas e ~120 plantas
numa ilha de 170 unidades de praia a praia. O custo ainda é baixo, mas cresce
com o tempo, e a cena fica entulhada. Em vários anos de mundo (algumas semanas
reais), o custo do render e o tamanho do save crescem junto.

**Correção:** limite por tipo (ex.: a escultura nova substitui a mais gasta) ou
densidade máxima de plantas por trecho.

### M4 — A jangada afundada sai boiando para longe

`a-jangada-que-afundou` põe um `CBody` boiante na jangada
(`src/story/stories.ts:225`) e nunca o retira. Na água, `physicsSystem` empurra
o corpo com o vento para sempre. Medido: uma construção chegou a
**|x| = 1 357,7**, onze vezes a meia-largura da ilha.

Como ela vira `destroço-jangada` com `condition = 0.25`, ela é a construção mais
danificada que existe, e `mostDamagedProp` a escolhe para `consertar`: ele anda
até a borda da ilha e "conserta" algo que está a um quilômetro. O mesmo vale
para os destroços do naufrágio e para os que a maré traz: eles entram no
conserto (302 consertos em 120 dias, ~2,5 por dia) e, apesar do comentário
"Ficam na praia para sempre" em `genesis.ts`, se desgastam e somem.

**Correção:** tirar o `CBody` ao final da história (ou destruir a jangada) e
excluir destroços de `mostDamagedProp`.

### M5 — Sem recuperação de perda de contexto WebGL (leitura)

Não há tratamento de `webglcontextlost` / `webglcontextrestored` em nenhum
lugar de `src/`. Num navegador isso é raro; num protetor de tela que fica aberto
por semanas no Windows, atualização de driver, suspensão e retomada, ou troca de
GPU derrubam o contexto, e o resultado é **tela preta até reiniciar**, com a
simulação ainda rodando.

**Correção:** escutar os dois eventos no canvas e recriar `Renderer` (programas,
buffers e framebuffers do pós) ao restaurar.

### M6 — Sair do protetor de tela não garante o salvamento (leitura)

Em modo protetor, `quit()` chama `app.quit()` direto (`electron/main.cjs:154`).
O único salvamento na saída é o `beforeunload` da página, que dispara um
`ipcRenderer.invoke` assíncrono; o processo principal pode terminar antes de o
`fs.writeFile` acabar. Na prática, perde-se até 45 s reais (90 minutos de mundo)
a cada saída. O comentário no topo do arquivo diz "o mundo é salvo antes de
sair", o que hoje não é garantido. A escrita atômica evita corrupção, mas não a
perda.

**Correção:** em `before-quit`, `preventDefault()`, pedir à página um
salvamento via IPC, esperar a confirmação (com um tempo máximo) e só então sair.

### M7 — Contrato do `.scr` incompleto (leitura)

`flag('c')` só reconhece `/c` exato (`electron/main.cjs:36`). O painel do
Windows chama a configuração como `/c:<HWND>`, e o botão "Configurar" pode
chamar o `.scr` **sem argumentos**. Nos dois casos cai em `MODE = 'janela'` e
abre a janela comum de 1600×900 em vez do diálogo. O README já diz que `/c`
não foi exercitado; esta é a causa provável do que vai aparecer quando for.

Também faltam: `app.requestSingleInstanceLock()` (o Windows pode disparar `/s`
de novo e dois processos passariam a gravar o mesmo save) e a saída por clique
sem movimento (`before-input-event` só recebe teclado).

### M8 — Robustez do save (leitura)

- `loadWorld` devolve `null` se `version` não bate (`src/persist/save.ts:119`):
  ao subir `PERSIST.version`, o mundo do usuário é **descartado em silêncio** e
  sobrescrito pelo primeiro autosave, 45 s depois. Não há migração nem cópia de
  segurança.
- Um save que é JSON válido mas está incompleto (sem `ecs`, por exemplo) faz
  `applySave` lançar uma exceção. `boot()` mostra o erro na tela de abertura e
  para. Isso se repete a cada abertura, e no protetor de tela não há como passar
  `?novo`. É um travamento permanente.

**Correção:** guardar o save rejeitado com outro nome; envolver `applySave` em
`try/catch` e recomeçar com aviso.

### M9 — Nenhum teste, CI ou lint

Não há testes, workflow de CI nem linter. O A1 entrou no repositório porque
nada roda `tsc` num push. Pelo menos `npm run typecheck` em CI, e o script
headless desta auditoria como teste de fumaça (rodar N dias sem exceção, sem
`NaN` e com fenômenos anunciados uma vez), pegariam A1, M1 e as próximas
regressões.

---

## 3. Itens da auditoria anterior que continuam abertos

| Item | Situação em 07/10 |
| --- | --- |
| D3 — `/s` e `/c` em tela real | continua aberto; ver M7 |
| D4 — `CEphemeral` morto | **aberto**: nenhum `world.add(…, CEphemeral)` |
| D5 — `CVisual.shadow` ignorado | **aberto**: nenhum leitor em `src/render` |
| D6 — configuração sem uso | **aberto**: `zoomRange`, `targetFps`, `idleFps`, `reflections`, `softShadowSteps`, `uRes`/`uZoom`, `Stage.Audio`/`Persist`, `Scheduler.cost` sem exibição. Novos: `Renderer.drawVignette` (morto desde o `post.ts`), `Brain.targetEntity`/`intent`/`frustration`, `driftwood.modo`/`sair` no preload (a página não usa) |
| "Barras verticais pálidas" | não reavaliado (sem GPU aqui) |

---

## 4. Achados de severidade baixa

- **B1 — Filtro de caminho do `app://`** (`electron/main.cjs:181`):
  `target.startsWith(distDir)` aceita pastas irmãs com o mesmo prefixo.
  Verificado: `app://driftwood/..%2Fdist-electron/x.js` resolve para
  `…/dist-electron/x.js` e passa. O risco é baixo, porque a página só carrega
  conteúdo local. A correção é usar `path.relative` e recusar `..`, ou comparar
  com `distDir + path.sep`.
- **B2 — Endurecimento do Electron:** não há CSP no `index.html` nem
  `will-navigate`/`setWindowOpenHandler`. Hoje não há conteúdo remoto, então é
  defesa em profundidade.
- **B3 — Física:** a condição que acorda corpos boiantes está invertida em
  relação ao comentário (`src/sim/systems.ts:70`). Ela acorda quando a água está
  **longe** (`> 0.9`), e por isso um corpo boiante em terra nunca fica dormindo.
- **B4 — Determinismo depois de carregar:** `Scheduler.tick` e a `freeList` do
  ECS não vão para o save. Os sistemas com `every: 10/20` mudam de fase e os ids
  de entidade passam a ser outros, então um mundo recarregado diverge de um que
  rodou sem parar. O README promete "recarregar não sorteia um mundo
  diferente", o que só vale para a ilha e os RNGs. Além disso, `fastForward` não
  avança `ctx.elapsed`.
- **B5 — Alocação por quadro:** `main.ts` diz que "nada aqui aloca por quadro",
  mas o laço e o `render` criam geradores (`world.query`), cópias de arrays,
  closures por desenhável, `Object.entries` e o array `fires`. Não medi impacto;
  é uma afirmação falsa no comentário.
- **B6 — HUD:** mostra só `activeStory` (a vaga "obra"); a vaga
  "acontecimento" (`sideStory`) não aparece.
- **B7 — `pack:scr` só funciona no Windows** (procura `electron.exe`). Está
  documentado, mas o erro diz "rode `npm install`", o que não resolve nada em
  Linux ou macOS.
- **B8 — `package.json`:** a descrição está sem acentos ("nautrago",
  "propria").

---

## 5. Documentação

- **`AUDITORIA.md` está desatualizada:** diz que existem dois programas GLSL (hoje
  há também o pós-processamento de `src/render/post.ts`, com bloom, tonemap e
  grão), que o projeto "não é um repositório git", usa caminhos
  `C:\Nova pasta\…` e conta 37 arquivos e 6 876 linhas (hoje são 39 arquivos
  `.ts` e 8 411 linhas).
- **`docs/ARCHITECTURE.md` e `docs/ROADMAP.md` estão vazios (0 bytes).** O
  primeiro duplica de nome o `docs/ARQUITETURA.md`, que tem conteúdo.
- **`docs/design/VISUAL_PIPELINE.md` está truncado:** termina no meio de um
  bloco de código, sem fechar a cerca ` ``` `.
- **README contraditório:** a seção "Protetor de tela" diz primeiro que abre
  "uma janela em tela cheia por monitor" e, no parágrafo seguinte, "uma única
  janela cobre todos os monitores". Só a segunda é verdade.
- **Tensão de princípio:** o README promete "Nenhum ativo de terceiros… não
  existe um único arquivo de imagem". O ADR-001 (status "Proposta") e o
  `registry.ts` já commitado apontam para um *pipeline* de assets. Vale decidir
  e registrar no ADR se a promessa continua valendo antes de seguir por esse
  caminho.
- `docs/ART_BIBLE.md` cita *Johnny Castaway* pelo nome como referência. Em
  documento interno, tudo bem; vale não levar o nome para o produto nem para a
  divulgação.

---

## 6. Ordem sugerida de correção

1. **A1** — uma linha; destrava `build`, `desktop` e `pack:scr`.
2. **M9** — CI com `typecheck` e o teste headless, para A1 não voltar.
3. **A3 e M1** — a crônica é a "única voz" do programa; as duas correções são pequenas.
4. **A2** — sem ela, o mundo esvazia em poucas horas reais.
5. **A4** — atualizar o Electron antes de distribuir qualquer `.scr`.
6. **M2, M4, M8** — robustez de semente, física e save.
7. **M5, M6, M7** — necessários para o modo protetor de tela ser confiável.
8. Seção 3, seção 4 e documentação.
