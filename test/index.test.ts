import { resolve } from "path";
import { upgrade } from '../src';
describe('index.test.ts', () => {
  it('faas 2 to 3', async () => {
    const baseDir = resolve(__dirname, './fixtures/faas-v2');
    await upgrade(baseDir);
  });
});