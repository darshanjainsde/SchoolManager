'use client';
import { useEffect } from 'react';
import { ownerHref } from '@/lib/hosts';

/**
 * sckools.com/sv/orders — the address the pitch promised the operator.
 * The desk itself lives on the owner console (owner host + platform login);
 * this page only walks you there.
 */
export default function SvOrdersRedirect() {
  useEffect(() => { window.location.replace(ownerHref('/platform/orders')); }, []);
  return (
    <main style={{ display: 'grid', placeItems: 'center', minHeight: '60vh', fontFamily: 'system-ui' }}>
      <p style={{ color: '#475569', fontSize: 14 }}>Taking you to the order desk…</p>
    </main>
  );
}
