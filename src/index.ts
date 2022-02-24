import { CommandCore } from '@midwayjs/command-core';
import { UpgradePlugin } from './plugin';
export * from './ast';
export * from './astUtils';
export * from './plugin';
export * from './interface';
export * from './utils';
export * from './configuration';
export const upgrade = async (cwd = process.cwd(), options = {}) => {
  const core = new CommandCore({
    config: {
      servicePath: cwd,
    },
    commands: ['upgrade'],
    options: options,
    log: console,
  });
  core.addPlugin(UpgradePlugin);
  await core.ready();
  await core.invoke(['upgrade']);
};
