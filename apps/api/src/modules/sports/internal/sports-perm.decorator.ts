import { ExecutionContext, SetMetadata, createParamDecorator } from '@nestjs/common';
import type { SportsPerm as Perm } from '@skoolos/types';

export const SPORTS_PERM_KEY = 'sportsPerm';

/** The permission a desk route needs beyond "is on the sports desk". Checked by `SportsDeskGuard`. */
export const SportsPerm = (perm: Perm) => SetMetadata(SPORTS_PERM_KEY, perm);

/** The caller's effective permission list, as resolved by `SportsDeskGuard`. */
export const DeskPerms = createParamDecorator((_: unknown, ctx: ExecutionContext): Perm[] => {
  const req = ctx.switchToHttp().getRequest<{ sportsPerms?: Perm[] }>();
  return req.sportsPerms ?? [];
});
