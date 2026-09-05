/**
 * What KIND of name is this, and may we point it at this school?
 *
 * The domain flow grew up around one case — a school buying stmarys.edu.in and
 * pointing it here — so every rule in it assumes the school controls the zone.
 * A `*.sckools.com` name breaks all of those assumptions at once: WE own the
 * zone, a wildcard already answers it, and the records we would hand the school
 * to add are records only we can add.
 *
 * Deciding the kind ONCE, here, is what stops the four call sites (validation,
 * setup instructions, the DNS check, the www alias) from each inventing their
 * own answer. Each of them inventing its own is exactly how a healthy school
 * got marked ERROR, how an unservable www.<sub>.<platform> redirect got
 * created, and how a control-plane hostname stayed attachable to a tenant.
 */

export type DomainKind = 'SUBDOMAIN' | 'CUSTOM';

export interface HostPolicy {
  /** The platform's own root, e.g. sckools.com. Its wildcard serves schools. */
  platformHost: string;
  /** The owner console's host — never a tenant. */
  ownerHost: string;
  /** The CNAME target we publish for custom domains. */
  ingressTarget: string;
}

export type Classification =
  | { ok: true; kind: DomainKind }
  | { ok: false; reason: string };

const strip = (h: string) => h.trim().toLowerCase().replace(/\.$/, '').split(':')[0];

/**
 * `schoolSlug` is required, not optional: "is this name allowed?" has no
 * answer without knowing WHICH school is asking. beacon.sckools.com is a
 * perfectly legal address — for beacon, and for nobody else. Making the
 * caller supply the slug is what turns the tenancy rule into a type error
 * when someone forgets it.
 */
export function classifyDomain(
  hostnameRaw: string,
  policy: HostPolicy,
  schoolSlug: string,
): Classification {
  const hostname = strip(hostnameRaw);
  const platform = strip(policy.platformHost);
  const owner = strip(policy.ownerHost);
  const ingress = strip(policy.ingressTarget);
  const slug = schoolSlug.trim().toLowerCase();

  // Our own control plane. Attaching any of these to a school would hand a
  // tenant the marketing site, the owner console, or the API — and `remove`
  // would later detach it from the hosting project for real.
  if (hostname === platform) {
    return { ok: false, reason: `${hostname} is the platform's own address and cannot belong to a school.` };
  }
  if (hostname === owner) {
    return { ok: false, reason: `${hostname} is the owner console and cannot belong to a school.` };
  }
  if (hostname === ingress) {
    return { ok: false, reason: `${hostname} is the ingress endpoint every custom domain points at.` };
  }

  const suffix = '.' + platform;
  if (hostname.endsWith(suffix)) {
    const label = hostname.slice(0, -suffix.length);

    // A wildcard certificate and a wildcard DNS record both match exactly ONE
    // label. www.raffles.sckools.com is therefore unservable no matter what we
    // attach it to — and creating it is what blocked removal with a 409.
    if (label.includes('.')) {
      return {
        ok: false,
        reason:
          `${hostname} has more than one label under ${platform}. The ${'*'}${suffix} wildcard ` +
          `matches a single label, so this address can never be served.`,
      };
    }

    // The tenancy rule. Without it, one school can claim another school's
    // address, and a LIVE Domain row outranks the slug convention in
    // SchoolLookupService — so the victim's URL would start serving the
    // claimant's site.
    if (label !== slug) {
      return {
        ok: false,
        reason:
          `${hostname} is reserved. Addresses under ${platform} are assigned automatically from each ` +
          `school's slug, and this one does not belong to this school.`,
      };
    }

    return { ok: true, kind: 'SUBDOMAIN' };
  }

  return { ok: true, kind: 'CUSTOM' };
}

/** The school's always-on address, which no Domain row is needed to serve. */
export function platformHostFor(schoolSlug: string, platformHost: string): string {
  return `${schoolSlug.toLowerCase()}.${strip(platformHost)}`;
}
