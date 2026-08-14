import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Headers,
  Param,
  Post,
} from '@nestjs/common';
import { loadLibraryEnv } from '../../../config/env';
import { ProvisioningService } from './provisioning.service';
import { ProvisionDto } from './dto';

/**
 * Platform-level routes: they act ACROSS orgs rather than within one, so there
 * is no tenant JWT and no `X-Library-Host` to resolve. Authorised by a bearer
 * `PROVISIONING_SECRET` instead, exactly as the cron routes are authorised by
 * `CRON_SECRET` — and for the same reason: no user session exists for a machine
 * calling in.
 *
 * AFTER THE MERGE these routes go away. Sckools will call `ProvisioningService`
 * in-process from wherever a `School` is created, and an HTTP hop between two
 * modules in one process is pure attack surface. They exist now because the
 * services are still separate and a school has to be creatable today.
 */
@Controller('internal/provisioning')
export class ProvisioningController {
  constructor(private readonly provisioning: ProvisioningService) {}

  /**
   * Fails CLOSED on an unset secret. This is the same shape the outbox sweep
   * got wrong — `if (secret && ...)` left an unauthenticated endpoint reachable
   * whenever the variable was missing, which it was, everywhere. An endpoint
   * that creates orgs must never be the second instance of that.
   */
  private assertAuthorised(auth: string | undefined): void {
    const secret = loadLibraryEnv().PROVISIONING_SECRET;
    if (!secret || auth !== `Bearer ${secret}`) {
      throw new ForbiddenException('This endpoint is for the platform');
    }
  }

  @Post()
  async provision(@Headers('authorization') auth: string | undefined, @Body() body: ProvisionDto) {
    this.assertAuthorised(auth);
    return this.provisioning.provision(body);
  }

  /**
   * Readiness for one school. Safe to call often — it is what the feature gate
   * consults to decide whether a menu item renders at all.
   */
  @Get('ready/:schoolId')
  async ready(
    @Headers('authorization') auth: string | undefined,
    @Param('schoolId') schoolId: string,
  ) {
    this.assertAuthorised(auth);
    return this.provisioning.ready(schoolId);
  }
}
