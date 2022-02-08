import { resolve } from "path";
import { upgrade } from '../src';
import { existsSync, remove, copy } from 'fs-extra';
describe('index.test.ts', () => {
  it('faas 2 to 3', async () => {
    const baseDir = resolve(__dirname, './fixtures/faas-v2');
    const target = resolve(__dirname, './fixtures/tmp/faas-v2');
    if (existsSync(target)) {
      await remove(target);
    }
    await copy(baseDir, target);
    await upgrade(target);
  });
});