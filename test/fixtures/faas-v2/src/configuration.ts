import { Configuration } from '@midwayjs/decorator';
import { ILifeCycle } from '@midwayjs/core';
import { join } from 'path';

@Configuration({
  importConfigs: [join(__dirname, './config/')],
  conflictCheck: true,
})
export class ContainerLifeCycle implements ILifeCycle {


  testKey = 123;

  testKey2 = 456;

  async onReady() {}
}
