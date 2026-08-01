import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'is_public';
/** Route accessible sans authentification (login, refresh, health…). */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
