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