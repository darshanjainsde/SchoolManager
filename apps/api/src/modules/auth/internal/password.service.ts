import { Injectable } from '@nestjs/common';
import argon2 from 'argon2';

/**
 * Argon2id with default parameters (timeCost=3, memoryCost=64MB, parallelism=1)
 * — meets OWASP 2023 recommendations for interactive logins.
 */
@Injectable()
export class PasswordService {
  hash(plain: string): Promise<string> {
    return argon2.hash(plain, { type: argon2.argon2id });
  }

  verify(hash: string, plain: string): Promise<boolean> {
    return argon2.verify(hash, plain).catch(() => false);
  }
}
