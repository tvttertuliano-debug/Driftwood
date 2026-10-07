import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { parseMode } = require('../electron/args.cjs') as {
  parseMode: (args: string[], packaged: boolean) => string;
};

describe('linha de comando do protetor de tela', () => {
  it.each([
    [['/s'], 'protetor'],
    [['/S'], 'protetor'],
    [['/c'], 'config'],
    [['/c:1234567'], 'config'],
    [['/C:1234567'], 'config'],
    [['/c', '1234567'], 'config'],
    [['/p', '1234567'], 'miniatura'],
    [['/p:1234567'], 'miniatura'],
    [[], 'config'],
    [['--allow-file-access'], 'config'],
  ])('empacotado: %j → %s', (args, mode) => expect(parseMode(args, true)).toBe(mode));

  it.each([
    [[], 'janela'],
    [['--dev'], 'dev'],
    [['/s'], 'protetor'],
    [['/c:42'], 'config'],
  ])('do código: %j → %s', (args, mode) => expect(parseMode(args, false)).toBe(mode));
});
