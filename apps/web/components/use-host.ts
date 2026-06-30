'use client';
import { useEffect, useState } from 'react';

/** Reads window.location.host once on mount — for use as the API Host header. */
export function useHost(): string | undefined {
  const [host, setHost] = useState<string | undefined>();
  useEffect(() => setHost(window.location.host), []);
  return host;
}
