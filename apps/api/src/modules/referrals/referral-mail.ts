/**
 * Every email Refer & Earn sends, in one place, in the words the promoter and
 * the owner read. All go through MailService.sendLetter with no school (platform
 * mail), kind 'REFERRAL', best-effort via runInBackground at the call site.
 */
import type { MailService } from '../../common/mail/mail.service';

const money = (minor: number) => `₹${Math.round(minor / 100).toLocaleString('en-IN')}`;

export class ReferralMail {
  constructor(private readonly mail: MailService, private readonly site: string) {}

  code(to: string, code: string): Promise<boolean> {
    return this.mail.sendLetter(to, null, `${code} is your Sckools code`, {
      title: 'Your sign-in code',
      preheader: `${code} — valid for ten minutes`,
      intro: `Your one-time code for Refer & Earn is ${code}. It is valid for ten minutes.`,
      note: 'If you did not ask for this, ignore this email; nothing happens without the code.',
    }, 'REFERRAL_CODE');
  }

  welcome(to: string, name: string): Promise<boolean> {
    return this.mail.sendLetter(to, null, 'Welcome to Refer & Earn', {
      title: `Welcome, ${name.split(' ')[0]}`,
      intro: 'Your promoter account is open. Ask for your commission rate from the dashboard, then log the first school you have in mind.',
      cta: { label: 'Open my dashboard', url: `${this.site}/promoter` },
    }, 'REFERRAL');
  }

  loginLink(to: string, name: string): Promise<boolean> {
    return this.mail.sendLetter(to, null, 'Your Sckools promoter account', {
      title: `${name.split(' ')[0]}, your account is ready`,
      intro: 'Sckools opened a Refer & Earn account for you. Sign in with this email address; a one-time code arrives each time, no password to remember.',
      cta: { label: 'Sign in', url: `${this.site}/earn#signin` },
    }, 'REFERRAL');
  }

  commissionSet(to: string, name: string, pct: number, capMinor: number | null, note: string | null): Promise<boolean> {
    return this.mail.sendLetter(to, null, `Your commission: ${pct}% per school`, {
      title: 'Your commission is set',
      intro: `${name.split(' ')[0]}, for every school you refer that goes live and pays, you earn ${pct}% of its first-year payment${capMinor ? `, up to ${money(capMinor)} per school` : ''}.`,
      quote: note || undefined,
      cta: { label: 'Log a referral', url: `${this.site}/promoter` },
    }, 'REFERRAL');
  }

  accepted(to: string, school: string): Promise<boolean> {
    return this.mail.sendLetter(to, null, `${school}: accepted`, {
      title: 'Referral accepted',
      intro: `${school} is yours. Sckools calls the contact next; every step shows on your dashboard.`,
      cta: { label: 'See the timeline', url: `${this.site}/promoter/referrals` },
    }, 'REFERRAL');
  }

  rejected(to: string, school: string, reason: string): Promise<boolean> {
    return this.mail.sendLetter(to, null, `${school}: not accepted`, {
      title: 'Referral not accepted',
      intro: `We could not accept ${school}.`,
      quote: reason,
      note: 'Write to admin@sckools.com if you think this is a mistake.',
    }, 'REFERRAL');
  }

  live(to: string, school: string, grossMinor: number, dueOn: Date, detailsMissing: boolean): Promise<boolean> {
    return this.mail.sendLetter(to, null, `${school} is live — ${money(grossMinor)} due to you`, {
      title: 'A school you referred is live',
      intro: `${school} has paid Sckools. Your reward of ${money(grossMinor)} is due on ${dueOn.toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}.`,
      note: detailsMissing ? 'Add your payout details (PAN and bank or UPI) in your account before then, or the money waits.' : 'Tax is deducted where the law asks; your statement shows gross, tax and net.',
      cta: { label: detailsMissing ? 'Add payout details' : 'See my payouts', url: `${this.site}/promoter/payouts` },
    }, 'REFERRAL');
  }

  paid(to: string, school: string, netMinor: number, utr: string): Promise<boolean> {
    return this.mail.sendLetter(to, null, `Paid: ${money(netMinor)} for ${school}`, {
      title: 'Your reward has been paid',
      intro: `${money(netMinor)} for ${school} has been transferred. Reference ${utr}.`,
      cta: { label: 'See the statement', url: `${this.site}/promoter/payouts` },
    }, 'REFERRAL');
  }

  statusChanged(to: string, status: 'SUSPENDED' | 'ACTIVE' | 'REMOVED', reason: string | null): Promise<boolean> {
    const title = status === 'ACTIVE' ? 'Your account is active again' : status === 'SUSPENDED' ? 'Your account is paused' : 'Your account has been closed';
    return this.mail.sendLetter(to, null, title, {
      title,
      intro: status === 'ACTIVE' ? 'You can log referrals again.' : 'Rewards already earned are still paid.',
      quote: reason || undefined,
      note: 'Write to admin@sckools.com with any question.',
    }, 'REFERRAL');
  }

  ownerTask(to: string, what: string, detail: string): Promise<boolean> {
    return this.mail.sendLetter(to, null, `Refer & Earn: ${what}`, {
      title: what,
      intro: detail,
      cta: { label: 'Open Referrals → Tasks', url: `${this.site.replace('https://', 'https://owner.')}/platform/referrals` },
    }, 'REFERRAL_OWNER');
  }
}
