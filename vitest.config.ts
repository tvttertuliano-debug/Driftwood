import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Os testes simulam dias de mundo de uma vez; num runner de CI compartilhado
    // alguns passam dos 5 s padrão sem nada de errado (o de recarga levou ~6 s).
    testTimeout: 60_000,
  },
});
