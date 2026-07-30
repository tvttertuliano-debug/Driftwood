# Arquitetura

Documento de referência para quem for mexer no código. O README conta *o que* o
programa faz; aqui está *por que* ele é montado assim.

## Princípio

O programa precisa rodar por semanas sem degradar, ser observado por horas sem
repetir, e crescer em conteúdo sem crescer em acoplamento. As três exigências
levam à mesma decisão: **dados separados de comportamento, comportamento separado
em sistemas independentes, e conteúdo declarado em tabelas, não em código de fluxo**.

## ECS

`src/core/ecs.ts`, sem dependências, ~300 linhas.

- **Armazenamento sparse-set.** Cada tipo de componente tem um vetor denso de
  dados, um vetor denso de entidades e um índice esparso `entidade -> posição`.
  Iterar é sequencial; remover é troca-com-o-último em tempo constante.
- **Consultas** varrem o menor store e testam presença nos demais.
- **Destruição adiada.** `destroy` marca; `flush` remove no fim do passo. Sem
  isso, um sistema que mata uma entidade durante a iteração invalidaria a
  varredura de outro.
- **Estágios.** `Time → Mind → Act → Physics → Ecology → Director → Audio →
  Persist`. A ordem é declarada, não emergente da ordem de import.
- **`every: N`.** Sistemas caros declaram sua própria taxa. Ecologia roda a cada
  10 passos, diretor a cada 20, envelhecimento a cada 20.
- **Serialização por componente.** Componentes marcados como não-persistentes
  (caches, efêmeros) ficam de fora do save. Ao carregar, campos novos ganham o
  padrão da fábrica, então saves antigos não quebram com componentes que
  ganharam campos.

Dados que não pertencem a nenhuma entidade — relógio, clima, ilha, crônica,
bandeiras — ficam num **recurso** (`WorldState`), não numa entidade-singleton
fingida.

## Determinismo

Toda a aleatoriedade passa por `Rng` (mulberry32), e há **fluxos separados**:
clima, narrativa, prodígios, ambiente e decisões do náufrago. Isso significa que
uma tempestade a mais não desloca o sorteio da próxima história — os subsistemas
não roubam números uns dos outros.

A ilha inteira é derivada da semente e **nunca é serializada**: a mesma semente
reconstrói o mesmo recorte de areia e pedra. Só a erosão acumulada é salva, como
um delta. `?semente=N` reproduz uma ilha exata.

## IA de utilidade

`src/ai/`. A cada passo:

1. **Necessidades derivam** (`needs.ts`) — taxas por segundo de mundo, moduladas
   por temperatura, hora e esforço. Medo é reativo ao clima; felicidade tende a
   uma linha de base calculada a partir das outras.
2. **Cada ação se autoavalia** (`actions.ts`). A curva `urgency` é quase zero até
   0,6 e depois domina — é o que faz sede vencer curiosidade sem `if`s aninhados.
3. **O cérebro escolhe** (`brain.ts`): pontuação × penalidade por repetição
   recente × ruído multiplicativo (0,78–1,22). Recarga bloqueia; ações urgentes
   podem interromper o que está em curso se valerem 60 % mais.
4. **O corpo executa**: caminha até o lugar, depois roda o `tick` da ação. O
   trajeto consome tempo da ação — distâncias importam.

Não existe máquina de estados, não existe árvore de comportamento, não existe
sequência roteirizada. O que parece intenção é pressão interna encontrando a
ação mais barata para aliviá-la.

**Ações são o único lugar que altera o mundo pelo personagem.** Uma ação nova não
exige registro em lugar nenhum: entra no catálogo e passa a ser considerada.

## Diretor narrativo

`src/story/`. Uma história é uma lista de passos com `requires`, `bias`, `weight`
e `cooldown`. Passos esperam tempo (`wait`), esperam uma condição (`until`, com
`timeout`) ou aplicam efeito e seguem.

O diretor mantém **uma história por vez**. A maioria das obras usa o molde
`projectStory`: cria uma construção com `progress: 0` e espera. Quem termina a
obra é a ação `construir`, escolhida pela utilidade — ou seja, **a narrativa
propõe e a IA dispõe**. Se ele estiver com medo, faminto ou preguiçoso, a obra
fica parada dias, e isso não é um bug.

Prodígios (`rareEvents.ts`) correm em paralelo, com frequência declarada em
"vezes por dia de mundo" e condições duras. No máximo um por vez.

> Armadilha conhecida: probabilidades aqui são **por segundo de mundo**, e um dia
> tem 86 400 deles. Errar a ordem de grandeza transforma um prodígio em rotina —
> foi exatamente o que aconteceu com o eclipse na primeira versão, que passou a
> acontecer várias vezes por tarde.

## Renderização

Um passe de tela cheia + um lote de triângulos + partículas.

1. **`backdrop.ts`** — céu e oceano num único fragment shader. O oceano é
   falso-3D: cada pixel abaixo do horizonte vira distância, e as ondas são somas
   de senos com deriva, com o número de oitavas ligado ao nível de qualidade.
   Reflexo do céu por Fresnel, caminho de luz do sol e da lua, cristas de espuma
   com vento forte, névoa marinha no horizonte.
2. **`painter.ts`** — pincel 2D em lote: triângulos com cor por vértice, um único
   buffer dinâmico, um `drawArrays` por quadro. Tudo que não é céu nem mar sai
   daqui: ilha, vegetação, construções, bichos, personagem, partículas.
3. **`palette.ts`** — modelo de luz. Não é física: são cores de pintura. A sombra
   nunca é preta, ela recebe a cor do céu; a perspectiva aérea some com o que
   está longe; a paleta da vegetação muda com a estação.
4. **`character.ts`** — o náufrago é um esqueleto articulado desenhado do zero a
   cada quadro. A pose é função da ação, do tempo e da idade. Barba, volume de
   cabelo, postura e roupa mudam com o envelhecimento.
5. **`particles.ts`** — arrays pré-alocados, buffer circular, sem alocação por
   quadro. Chuva vira respingo ao bater na água; vaga-lumes só em noite calma.

Ordem de desenho: fundo → ilha → entidades ordenadas por profundidade (e, no
empate, por altura) → partículas → véu de clima → vinheta.

### Cuidados aprendidos na tela

- **O mar é desenhado antes da ilha e está à frente no diorama.** A ilha, então,
  não pode pintar abaixo da linha d'água — ela termina numa "saia" curta que
  perde opacidade. Sem isso a praia vira uma laje retangular boiando.
- **Gradiente com `triShaded`, não faixas empilhadas.** A vinheta original eram
  quatro retângulos translúcidos e apareciam como retângulos translúcidos.
- **Inclinação medida em janela larga.** Usar a derivada do segmento fazia o
  ruído do terreno virar listras verticais claras e escuras.
- **Nada de terra no horizonte.** Havia uma cordilheira distante para dar escala;
  foi removida porque terra à vista contradiz o assunto do programa.

## Áudio

Nenhuma amostra. Mar, vento e chuva são ruído (marrom ou branco) filtrado, com
ganho e frequência de corte amarrados ao clima e à distância da câmera. Bichos
são osciladores curtos: pássaros de dia, insetos de noite, nunca ao mesmo tempo.
Trovão é um estouro de ruído com varredura de passa-baixas.

Música só em três situações: obra terminada, prodígio e descoberta. Três notas,
no máximo. O silêncio é parte da experiência.

## Persistência

Save versionado com o ECS inteiro, relógio, clima, erosão, bandeiras, recargas de
história e o estado dos cinco geradores aleatórios. No desktop a escrita é
atômica (arquivo temporário + `rename`), porque um protetor de tela é justamente
o tipo de programa que é interrompido por desligamento.

## Orçamento de desempenho

| Mecanismo | Onde |
| --- | --- |
| Passo fixo com teto de recuperação | `main.ts` |
| Taxas por sistema (`every`) | `core/ecs.ts` |
| Corpos que dormem | `sim/systems.ts` |
| Pools sem alocação | `render/particles.ts` |
| Rebaixamento automático de qualidade | `render/renderer.ts` |
| Teto de pixels internos | `render/renderer.ts` |
| Suspensão de áudio em segundo plano | `main.ts` |
