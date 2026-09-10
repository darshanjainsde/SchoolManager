'use client';
import { useParams } from 'next/navigation';
import TournamentView from '../../tournament-view';

export default function AppSportsTournamentPage() {
  const params = useParams<{ id: string }>();
  return <TournamentView base="/app/sports" id={params.id} />;
}
