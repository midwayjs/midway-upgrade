import { resolve } from 'path';
import { upgrade } from '../src';
import { existsSync, remove, copy } from 'fs-extra';
import { run } from './utils';
import axios from 'axios';
describe('index.test.ts', () => {
  it('faas 2 to 3', async () => {
    const baseDir = resolve(__dirname, './fixtures/faas-v2');
    const target = resolve(__dirname, './fixtures/tmp/faas-v2');
    if (existsSync(target)) {
      await remove(target);
    }
    await copy(baseDir, target);
    await upgrade(target);
    const { close, port } = await run(target, { port: '12330' });
    const now = `${Date.now()}`;
    const res = await axios.get(`http://127.0.0.1:${port}/?name=${now}`);
    await close();
    expect(res.data).toEqual(`Hello ${now}`);
  });
  it('web 2 to 3', async () => {
    const baseDir = resolve(__dirname, './fixtures/web-v2');
    const target = resolve(__dirname, './fixtures/tmp/web-v2');
    const lockFile = resolve(
      __dirname,
      './fixtures/tmp/web-v2/package-lock.json'
    );
    if (existsSync(target)) {
      await remove(target);
    }
    await copy(baseDir, target);
    await upgrade(target);
    if (existsSync(lockFile)) {
      await remove(lockFile);
    }
    const { close, port } = await run(target, { port: '12331' });
    const now = `${Date.now()}`;
    const res = await axios.get(`http://127.0.0.1:${port}/?name=${now}`);
    await close();
    expect(res.data).toEqual(`Hello ${now}`);
  });
});
