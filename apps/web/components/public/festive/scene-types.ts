import type { ReactNode } from 'react';
import type { FestiveTreatment } from '../site-variants';

export interface SceneProps {
  /** One of the festival's own variants (see scenes.tsx). */
  variant: string;
  treatment: FestiveTreatment;
  /** True on NIGHT — scenes turn their lights up and their fills down. */
  night: boolean;
  /** The school's own picture for the scene, when it uploaded one. */
  imageUrl: string | null;
}
export type Scene = (p: SceneProps) => ReactNode;
