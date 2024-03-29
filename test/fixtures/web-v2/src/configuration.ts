import { App, Configuration } from '@midwayjs/decorator';
import { ILifeCycle } from '@midwayjs/core';
import { Application } from 'egg';
import { join } from 'path';
const env = 'pre';

@Configuration({
  importConfigs: [join(__dirname, './config')],
  imports: [...(env === 'pre'? []: [])],
  conflictCheck: true,
})
export class ContainerLifeCycle implements ILifeCycle {
  @App()
  app: Application;

  async onReady() {}
}
