import { Controller, Get, Query, Provide } from '@midwayjs/decorator';

@Provide()
@Controller('/')
export class HomeController {
  @Get('/')
  async handleHTTPEvent(@Query() name = 'midwayjs') {
    return `Hello ${name}`;
  }
}
