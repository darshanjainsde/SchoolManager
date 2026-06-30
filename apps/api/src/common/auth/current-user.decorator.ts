import { ExecutionContext, createParamDecorator } from '@nestjs/common';
import type { AnyJwtPayload } from './jwt-payload';

export const CurrentUser = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): AnyJwtPayload | undefined => {
    const req = ctx.switchToHttp().getRequest<{ user?: AnyJwtPayload }>();
    return req.user;
  },
);
