import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'is_public';
/** Mark an endpoint as not requiring authentication. */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
