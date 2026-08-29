'use client';
import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Copy, Lock, Upload } from 'lucide-react';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';
import type { PaymentSetup } from '@/lib/fees';

/**
 * How parents can pay.
 *
 * Two blocks: the gateways (off until Sckools finishes onboarding) and the
 * bank details (live today). The gateway cards are rendered entirely from each
 * provider's OWN declared `fields` — this screen knows nothing about PhonePe,
 * which is what makes adding Cashfree later a backend-only change.
 *
 * The right-hand panel shows what a parent will actually see, live as you type.
 * It is the fastest way to catch an account number typed one digit short.
 */
export default function PaymentSetupPage() {
  const host = useHost();
  const api = useApi({ audience: 'school', hostHeader: host });
  const qc = useQueryClient();

  const setup = useQuery({
    queryKey: ['fee-payment-setup', host], enabled: !!host,
    queryFn: () => api.get<PaymentSetup>('/manage/fees/payment-setup'),
  });

  const [bank, setBank] = useState({
    accountName: '', accountNumber: '', ifsc: '', bankName: '',
    branch: '', upiId: '', instructions: '', isVisible: false,
  });
  useEffect(() => {
    const b = setup.data?.bank;
    if (b) setBank({
      accountName: b.accountName, accountNumber: b.accountNumber, ifsc: b.ifsc,
      bankName: b.bankName, branch: b.branch ?? '', upiId: b.upiId ?? '',
      instructions: b.instructions ?? '', isVisible: b.isVisible,
    });
  }, [setup.data]);

  const saveBank = useMutation({
    mutationFn: () => api.put('/manage/fees/payment-setup/bank', {
      ...bank,
      branch: bank.branch || undefined,
      upiId: bank.upiId || undefined,
      instructions: bank.instructions || undefined,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['fee-payment-setup', host] });
      toast.success(bank.isVisible ? 'Saved — parents can see these details now' : 'Saved');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (setup.isLoading || !setup.data) return <p className="sk-state">Loading payment settings…</p>;

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-5">
      <header className="sk-pagehead">
        <h1>How can parents pay?</h1>
        <p>Bank transfer works today. Online payment switches on once your school is set up with a gateway.</p>
      </header>

      <section className="flex flex-col gap-2">
        <h2 className="sk-lab">Online payment</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          {setup.data.providers.map((p) => (
            <ProviderCard key={p.key} provider={p} api={api} qc={qc} host={host} />
          ))}
        </div>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="sk-lab flex items-center gap-2">
          Bank transfer
          <span className="sk-pill" data-tone="good">Available now</span>
        </h2>

        <div className="grid gap-3 lg:grid-cols-2">
          <div className="sk-card">
            <div className="sk-card-b">
              <label className="flex items-center gap-2 text-[12.5px] font-semibold">
                <input type="checkbox" checked={bank.isVisible}
                       onChange={(e) => setBank({ ...bank, isVisible: e.target.checked })} />
                Show these details to parents
              </label>
              <p className="text-[11px]" style={{ color: 'var(--sk-ink-3)' }}>
                Until this is on, parents see no way to pay.
              </p>

              {([
                ['accountName', 'Account name', 'Saraswati Vidya Mandir Samiti'],
                ['accountNumber', 'Account number', '50100 2847 91036'],
                ['ifsc', 'IFSC', 'HDFC0001432'],
                ['bankName', 'Bank', 'HDFC Bank'],
                ['branch', 'Branch (optional)', 'Sikar Road, Jaipur'],
                ['upiId', 'UPI ID (optional)', 'yourschool@bank'],
              ] as const).map(([k, label, ph]) => (
                <div key={k} className="flex flex-col gap-1.5">
                  <label className="sk-lab" htmlFor={`bank-${k}`}>{label}</label>
                  <input id={`bank-${k}`} className="sk-input" placeholder={ph}
                         value={bank[k]} onChange={(e) => setBank({ ...bank, [k]: e.target.value })} />
                </div>
              ))}

              <div className="flex flex-col gap-1.5">
                <label className="sk-lab" htmlFor="bank-instructions">Note to parents (optional)</label>
                <input id="bank-instructions" className="sk-input"
                       placeholder="Write your child's admission number in the payment remark."
                       value={bank.instructions}
                       onChange={(e) => setBank({ ...bank, instructions: e.target.value })} />
              </div>

              <QrUpload api={api} qc={qc} host={host} current={setup.data.bank?.upiQrUrl ?? null}
                        canUpload={!!setup.data.bank} />

              <button className="sk-btn self-start" data-variant="primary"
                      disabled={saveBank.isPending || !bank.accountName || !bank.accountNumber || !bank.ifsc || !bank.bankName}
                      onClick={() => saveBank.mutate()}>
                {saveBank.isPending ? 'Saving…' : 'Save bank details'}
              </button>
            </div>
          </div>

          <ParentPreview bank={bank} qrUrl={setup.data.bank?.upiQrUrl ?? null}
                         canPayOnline={setup.data.providers.some((p) => p.available && p.enabled)} />
        </div>
      </section>
    </div>
  );
}

type Api = ReturnType<typeof useApi>;
type Qc = ReturnType<typeof useQueryClient>;

function ProviderCard({
  provider, api, qc, host,
}: { provider: PaymentSetup['providers'][number]; api: Api; qc: Qc; host: string | undefined }) {
  const [values, setValues] = useState<Record<string, string>>({});

  const save = useMutation({
    mutationFn: (enabled: boolean) => {
      const config: Record<string, string> = {};
      const secrets: Record<string, string> = {};
      for (const f of provider.fields) {
        const v = values[f.name];
        if (v === undefined || v === '') continue;
        (f.secret ? secrets : config)[f.name] = v;
      }
      return api.put('/manage/fees/payment-setup/provider', { provider: provider.key, enabled, config, secrets });
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['fee-payment-setup', host] }); toast.success('Saved'); },
    onError: (e: Error) => toast.error(e.message),
  });

  const tone = provider.status === 'ACTIVE' ? 'good' : provider.status === 'PENDING' ? 'warn' : 'neutral';
  const label = provider.available
    ? provider.status === 'ACTIVE' ? 'On' : 'Not set up'
    : 'Coming soon';

  return (
    <div className="sk-card" style={{ opacity: provider.available ? 1 : 0.85 }}>
      <div className="sk-card-h">
        <h3>{provider.displayName}</h3>
        <span className="sk-pill" data-tone={tone} style={{ marginLeft: 'auto' }}>{label}</span>
        <p>{provider.blurb}</p>
      </div>
      <div className="sk-card-b">
        {!provider.available && (
          <p className="rounded-[9px] p-2 text-[11.5px]"
             style={{ background: 'var(--sk-amber-tint)', color: 'var(--sk-amber-ink)' }}>
            Sckools is completing onboarding with {provider.displayName}. Once that is done your school
            gets its own merchant ID and money settles straight into your own bank account.
          </p>
        )}

        {provider.fields.filter((f) => f.scope === 'SCHOOL').map((f) => (
          <div key={f.name}>
            <label className="sk-lab flex items-center gap-1" htmlFor={`${provider.key}-${f.name}`}>
              {f.label}
              {f.secret && <Lock size={10} aria-label="stored encrypted" />}
            </label>
            <input
              id={`${provider.key}-${f.name}`}
              className="sk-input"
              type={f.secret ? 'password' : 'text'}
              disabled={!provider.available}
              placeholder={f.hasValue && f.secret ? '•••••••• saved' : (f.placeholder ?? '')}
              defaultValue={f.secret ? '' : (f.value ?? '')}
              onChange={(e) => setValues({ ...values, [f.name]: e.target.value })}
            />
            {f.help && <p className="mt-0.5 text-[10.5px]" style={{ color: 'var(--sk-ink-3)' }}>{f.help}</p>}
          </div>
        ))}

        <div className="flex gap-2">
          <button className="sk-btn" disabled={!provider.available || save.isPending}
                  onClick={() => save.mutate(false)}>Save</button>
          <button className="sk-btn" data-variant="primary"
                  disabled={!provider.available || save.isPending}
                  onClick={() => save.mutate(true)}>Turn on</button>
        </div>
      </div>
    </div>
  );
}

function QrUpload({
  api, qc, host, current, canUpload,
}: { api: Api; qc: Qc; host: string | undefined; current: string | null; canUpload: boolean }) {
  const input = useRef<HTMLInputElement>(null);

  const upload = useMutation({
    mutationFn: async (file: File) => {
      const form = new FormData();
      form.append('file', file);
      return api.post('/manage/fees/payment-setup/bank/qr', form);
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['fee-payment-setup', host] }); toast.success('QR code updated'); },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div>
      <span className="sk-lab">UPI QR code (optional)</span>
      <div className="mt-1 flex items-center gap-3">
        {current
          ? <img src={current} alt="Your UPI QR code" width={72} height={72}
                 className="rounded-[9px] border" style={{ borderColor: 'var(--sk-line-2)' }} />
          : <div className="grid h-[72px] w-[72px] place-items-center rounded-[9px] border text-[10px]"
                 style={{ borderColor: 'var(--sk-line-2)', color: 'var(--sk-ink-3)' }}>none</div>}
        <div>
          <button className="sk-btn" disabled={!canUpload || upload.isPending}
                  onClick={() => input.current?.click()}>
            <Upload size={14} /> {current ? 'Replace' : 'Upload'}
          </button>
          <p className="mt-1 text-[10.5px]" style={{ color: 'var(--sk-ink-3)' }}>
            {canUpload ? 'PNG or JPG, up to 2 MB.' : 'Save your bank details first.'}
          </p>
        </div>
        <input ref={input} type="file" accept="image/*" className="hidden"
               onChange={(e) => { const f = e.target.files?.[0]; if (f) upload.mutate(f); }} />
      </div>
    </div>
  );
}

/** Live mirror of the parent's screen. Catches a typo before a parent does. */
function ParentPreview({
  bank, qrUrl, canPayOnline,
}: { bank: { accountName: string; accountNumber: string; ifsc: string; bankName: string; upiId: string; instructions: string; isVisible: boolean }; qrUrl: string | null; canPayOnline: boolean }) {
  return (
    <div className="rounded-[16px] border border-dashed p-4" style={{ borderColor: 'var(--sk-line-2)', background: 'var(--sk-bg-2)' }}>
      <div className="sk-lab mb-2">What parents will see</div>

      {!bank.isVisible ? (
        <p className="sk-state">
          Nothing yet — turn on “Show these details to parents” and this is what appears on their fees page.
        </p>
      ) : (
        <div className="sk-card">
          <div className="sk-card-b">
            {!canPayOnline && (
              <div className="rounded-[9px] border p-2 text-center text-[11px]"
                   style={{ borderColor: 'var(--sk-line)', color: 'var(--sk-ink-3)' }}>
                Pay now — online<br /><span className="text-[10px]">coming soon</span>
              </div>
            )}
            <div className="sk-lab">Pay by bank transfer</div>
            <div className="text-[12px] leading-7" style={{ fontFamily: 'var(--sk-mono)' }}>
              <div>{bank.accountName || '—'}</div>
              <div>A/c {bank.accountNumber || '—'} <Copy size={11} className="inline" style={{ color: 'var(--sk-brand-2)' }} /></div>
              <div>IFSC {bank.ifsc || '—'} <Copy size={11} className="inline" style={{ color: 'var(--sk-brand-2)' }} /></div>
              {bank.upiId && <div>UPI {bank.upiId} <Copy size={11} className="inline" style={{ color: 'var(--sk-brand-2)' }} /></div>}
            </div>
            {qrUrl && (
              <div className="flex items-center gap-2">
                <img src={qrUrl} alt="" width={60} height={60} className="rounded-[8px] border"
                     style={{ borderColor: 'var(--sk-line-2)' }} />
                <p className="text-[10.5px]" style={{ color: 'var(--sk-ink-3)' }}>
                  Scan with any UPI app.<br /><strong>Amount is not pre-filled.</strong>
                </p>
              </div>
            )}
            {bank.instructions && (
              <p className="border-t pt-2 text-[11px]" style={{ borderColor: 'var(--sk-line)', color: 'var(--sk-ink-3)' }}>
                {bank.instructions}
              </p>
            )}
            <div className="rounded-[9px] p-2 text-center text-[11.5px] font-semibold"
                 style={{ background: 'var(--sk-brand)', color: '#fff' }}>
              I have paid — send details
            </div>
          </div>
        </div>
      )}

      <p className="mt-3 text-[10.5px] leading-snug" style={{ color: 'var(--sk-ink-3)' }}>
        The <strong>Pay now</strong> button appears here on its own the day a gateway is switched on
        above — nothing on this screen or the parent&rsquo;s needs redesigning.
      </p>
    </div>
  );
}
