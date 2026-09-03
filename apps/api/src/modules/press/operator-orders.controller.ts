import {
  Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, UseGuards,
} from '@nestjs/common';
import { OwnerHostGuard } from '../../common/auth/owner-host.guard';
import { PlatformJwtGuard } from '../../common/auth/platform-jwt.guard';
import { OperatorOrdersService } from './operator-orders.service';
import { DeclineOrderDto, DispatchOrderDto, QuoteOrderDto } from './press-orders.dto';

/**
 * The operator's order desk — sckools.com/sv/orders. Owner host + platform
 * JWT, the same wall as the rest of the owner console: this is the ONE place
 * print orders cross tenants, and it is ours.
 */
@Controller('owner/print-orders')
@UseGuards(OwnerHostGuard, PlatformJwtGuard)
export class OperatorOrdersController {
  constructor(private readonly orders: OperatorOrdersService) {}

  @Get()
  list(@Query('status') status?: string) {
    return this.orders.listAll(status);
  }

  @Get(':id')
  one(@Param('id', ParseUUIDPipe) id: string) {
    return this.orders.one(id);
  }

  /** What to print: frozen snapshots, or a short-lived link to the PDF. */
  @Get(':id/artifact')
  artifact(@Param('id', ParseUUIDPipe) id: string) {
    return this.orders.artifact(id);
  }

  /** Price + promised date. The promise is logged; the desk measures against it. */
  @Post(':id/quote') @HttpCode(200)
  quote(@Param('id', ParseUUIDPipe) id: string, @Body() dto: QuoteOrderDto) {
    return this.orders.quote(id, dto);
  }

  @Post(':id/decline') @HttpCode(200)
  decline(@Param('id', ParseUUIDPipe) id: string, @Body() dto: DeclineOrderDto) {
    return this.orders.decline(id, dto);
  }

  @Post(':id/printing') @HttpCode(200)
  printing(@Param('id', ParseUUIDPipe) id: string) {
    return this.orders.markPrinting(id);
  }

  @Post(':id/dispatch') @HttpCode(200)
  dispatch(@Param('id', ParseUUIDPipe) id: string, @Body() dto: DispatchOrderDto) {
    return this.orders.dispatch(id, dto);
  }

  @Post(':id/delivered') @HttpCode(200)
  delivered(@Param('id', ParseUUIDPipe) id: string) {
    return this.orders.markDelivered(id);
  }
}
