import { PRICING_FAQ } from './pricing-faq-data';

export default function PricingFaq() {
  return (
    <section className="faq-sec" aria-label="Pricing FAQ">
      <div className="wrap" style={{ maxWidth: 760 }}>
        <h2 className="h-lg" style={{ textAlign: 'center' }}>Questions schools ask us</h2>
        <div className="faq-list">
          {PRICING_FAQ.map((f) => (
            <details className="faq-item" key={f.q}>
              <summary>{f.q}</summary>
              <p>{f.a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}
