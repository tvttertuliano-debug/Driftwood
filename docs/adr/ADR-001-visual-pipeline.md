# ADR-001 — Nova Pipeline Visual do Driftwood

Status: Proposta

Data: 2026-07-30

---

# Contexto

O Driftwood possui uma arquitetura de simulação robusta baseada em ECS,
IA de utilidade e mundo persistente.

O renderer atual prioriza:

- simplicidade;
- geração procedural;
- ausência de assets externos.

Porém a qualidade visual atual não transmite a profundidade da simulação.

---

# Problema

A apresentação visual parece uma demonstração técnica.

O objetivo é alcançar uma experiência contemplativa,
com aparência de animação cinematográfica.

---

# Decisão

Criar uma nova pipeline gráfica separada da simulação.

A simulação continua responsável pelo mundo.

O renderer apenas interpreta esse mundo.

---

# Nova arquitetura

World Simulation

↓

Render Extraction

↓

Visual Systems:

- Terrain Renderer
- Ocean Renderer
- Character Renderer
- Particle Renderer
- Lighting Renderer

↓

Post Processing

↓

Display

---

# Princípios

## Separação

Nenhum sistema visual altera a simulação.

---

## Escalabilidade

A pipeline deve permitir:

- novos materiais;
- novos efeitos;
- novos ambientes;
- novos personagens.

---

## Performance

O projeto deve continuar funcionando por semanas.

---

# Prioridades

## Fase 1

- novo oceano;
- nova iluminação;
- nova câmera.

## Fase 2

- materiais;
- vegetação;
- partículas.

## Fase 3

- efeitos avançados;
- pós-processamento.

---

# Resultado esperado

O Driftwood deve parecer:

"uma pintura viva que continua existindo."