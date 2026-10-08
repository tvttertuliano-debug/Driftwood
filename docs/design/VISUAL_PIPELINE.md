# Visual Pipeline — Driftwood

## Objetivo

Este documento define a arquitetura visual do Driftwood.

A renderização deve separar:

- dados artísticos;
- composição visual;
- comportamento;
- tecnologia de desenho.

O objetivo é permitir evolução artística sem modificar o núcleo do motor.

---

# Princípios

## 1. Arte é dado

Elementos visuais não devem ser codificados diretamente no fluxo do renderer.

Exemplo:

Errado:

```ts
drawPalmTree()
drawRock()
drawFire()
```

Certo — é o que o código faz hoje (`src/art/assets/`):

```ts
// a simulação só diz QUAL asset a entidade é (um nome de ids.ts, checado em compilação)
world.add(e, CVisual, { brush: 'planta', seed, opacity: 1, shadow: 0.7 });

// o renderer não conhece palmeiras: resolve o nome no catálogo e chama o pincel
const { draw } = resolveAsset(vis.brush);
draw(ctx);
```

> Nota (auditoria de 07/10/2026): o arquivo terminava no meio do exemplo
> "Errado", com o bloco de código aberto. O exemplo "Certo" acima descreve o
> catálogo que existe no código; as seções seguintes do documento original
> não foram escritas e continuam por fazer.
