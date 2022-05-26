import { CommandCore, exec } from '@midwayjs/command-core';
import { DevPlugin } from '@midwayjs/cli-plugin-dev';
const sleep = time => {
  return new Promise(resolve => {
    setTimeout(resolve, time);
  });
};

export const wait = (time?) => {
  return new Promise(resolve => {
    setTimeout(resolve, time || 20000);
  });
};
export const run = async (cwd: string, options: any = {}) => {
  let npmCmd = 'npm';
  if (process.env.LANG === 'zh_CN.UTF-8') {
    npmCmd = 'npm --registry=https://registry.npmmirror.com';
  }
  await exec({
    baseDir: cwd,
    cmd: npmCmd + ' install',
  });
  const ls = await exec({
    baseDir: cwd,
    cmd: 'npm ls @midwayjs/decorator',
  });
  console.log('lsxxx', ls.toString());
  const core = new CommandCore({
    commands: ['dev'],
    options,
    log: {
      log: console.log,
    },
    cwd,
  });
  core.addPlugin(DevPlugin);
  await core.ready();
  core.invoke(['dev'], false, {
    ts: true,
    ...options,
  });
  let i = 0;
  let port;
  while (!port && i < 10) {
    i++;
    port = core.store.get('global:dev:port');
    await sleep(1000);
  }
  return {
    close: core.store.get('global:dev:closeApp'),
    port,
    getData: core.store.get('global:dev:getData'),
  };
};
