'use client';
import { useParams } from 'next/navigation';
import TournamentView from '@/app/app/sports/tournament-view';

export default function SportsTournamentPage() {
  const params = useParams<{ id: string }>();
  return <TournamentView base="/sports" id={params.id} />;
}
