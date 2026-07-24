import { useEffect, useState } from 'react';
import { Redirect } from 'expo-router';
import { session } from '@/lib/session';
import { portalForRole } from '@/lib/roles';

export default function Index() {
  const [target, setTarget] = useState<string | null>(null);
  useEffect(() => {
    (async () => {
      const s = await session.get();
      if (s) { setTarget(portalForRole(s.role)); return; }
      setTarget((await session.getSchoolHost()) ? '/(auth)/login' : '/(auth)/connect');
    })();
  }, []);
  if (!target) return null;
  return <Redirect href={target as never} />;
}
