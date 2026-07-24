import type { Role } from './session';

export function portalForRole(role: Role): '/(family)/home' | '/(staff)/today' {
  switch (role) {
    case 'STUDENT': return '/(family)/home';
    case 'TEACHER':
    case 'SCHOOL_ADMIN':
    case 'STAFF': return '/(staff)/today';
    case 'OWNER': throw new Error('Owner accounts use the web console.');
  }
}
