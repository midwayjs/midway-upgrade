import { Controller, Get, Query, Provide, Rule, RuleType } from '@midwayjs/decorator';

@Provide()
@Controller('/')
export class HomeController {
  @Get('/')
  async handleHTTPEvent(@Query() name = 'midwayjs') {
    return `Hello ${name}`;
  }

  @Rule(RuleType.string().max(10))
  @Get('/rule')
  async ruleTest(@Query() name = 'midwayjs') {
    return `Hello ${name}`;
  }
}
