/**
 * The one normalisation every phone on the platform goes through before it
 * is compared, indexed or messaged. Re-exported from the WhatsApp helper so
 * login, the person records and the channel all agree on what "+91…" means.
 */
export { toE164 } from '../notifications/whatsapp/phone';

/** "+91 98••• •3210" — enough to recognise your own number, useless to anyone else. */
export function maskPhone(e164: string): string {
  const d = e164.replace(/^\+/, '');
  if (d.length < 8) return e164;
  const cc = d.slice(0, d.length - 10) || '';
  const n = d.slice(-10);
  return `+${cc} ${n.slice(0, 2)}••• •${n.slice(-4)}`.replace(/\s+/g, ' ').trim();
}
