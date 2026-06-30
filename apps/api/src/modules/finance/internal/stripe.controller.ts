import {
  BadRequestException,
  Body,
  Controller,
  Headers,
  HttpCode,
  NotFoundException,
  Param,
  Post,
  RawBodyRequest,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import Stripe from 'stripe';
import { getPlatformPrisma, UserRole, withTenant } from '@skoolos/db';
import { SchoolJwtGuard } from '../../../common/auth/school-jwt.guard';
import { RolesGuard } from '../../../common/auth/roles.guard';
import { Roles } from '../../../common/auth/roles.decorator';
import { Public } from '../../../common/auth/public.decorator';
import { TenantContextService } from '../../tenancy';
import { StripeService } from './stripe.service';
import { StartCheckoutDto } from './finance.dto';

/**
 * Stripe checkout for an Invoice + webhook for payment events.
 *
 * Webhook idempotency:
 *   - Stripe redelivers the same event many times. We use the event's `id` as
 *     a unique Payment.stripeEventId index (set in schema). Inserting the
 *     same event twice → unique-constraint failure → swallow → 200 OK.
 *
 * Subscription mirror:
 *   - `customer.subscription.*` events update the local Subscription row.
 *   - `invoice.paid` for SkoolOS subscription is also caught (we tag the
 *     intent's metadata with `kind=subscription` to disambiguate).
 */
@ApiTags('finance-stripe')
@Controller()
export class StripeController {
  constructor(
    private readonly stripe: StripeService,
    private readonly tenantCtx: TenantContextService,
  ) {}

  // ── Checkout for an invoice ────────────────────────────────────────────
  @ApiBearerAuth()
  @UseGuards(SchoolJwtGuard, RolesGuard)
  @Roles(UserRole.SCHOOL_ADMIN, UserRole.STAFF, UserRole.STUDENT, UserRole.PARENT)
  @Post('invoices/:id/checkout')
  async checkout(@Param('id') id: string, @Body() dto: StartCheckoutDto) {
    const { schoolId, schoolSlug } = this.tenantCtx.requireTenant();
    const stripe = await this.stripe.client();
    const invoice = await withTenant(schoolId, (tx) => tx.invoice.findUnique({ where: { id } }));
    if (!invoice) throw new NotFoundException();
    const amountCents = Math.round(Number(invoice.amountDue) * 100);
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: [
        {
          price_data: {
            currency: invoice.currency.toLowerCase(),
            product_data: { name: `Invoice #${invoice.number}` },
            unit_amount: amountCents,
          },
          quantity: 1,
        },
      ],
      success_url: dto.successUrl ?? `https://${schoolSlug}.skoolos.app/app/finance/invoices/${id}?paid=1`,
      cancel_url: dto.cancelUrl ?? `https://${schoolSlug}.skoolos.app/app/finance/invoices/${id}?canceled=1`,
      metadata: {
        kind: 'invoice',
        schoolId,
        invoiceId: id,
      },
    });
    return { sessionUrl: session.url, sessionId: session.id };
  }

  // ── Webhook (NO auth, no tenant) ──────────────────────────────────────
  @Public()
  @Post('webhooks/stripe')
  @HttpCode(200)
  async webhook(
    @Req() req: RawBodyRequest<Request>,
    @Headers('stripe-signature') signature: string,
  ) {
    if (!signature) throw new BadRequestException('Missing stripe-signature header');
    if (!req.rawBody) throw new BadRequestException('Webhook needs raw body');
    let event: Stripe.Event;
    try {
      event = await this.stripe.constructEvent(req.rawBody, signature);
    } catch (e) {
      throw new BadRequestException('Invalid signature: ' + (e as Error).message);
    }

    // Replay-safe by stripeEventId unique constraint on Payment.
    const platform = getPlatformPrisma();
    switch (event.type) {
      case 'checkout.session.completed':
      case 'payment_intent.succeeded': {
        const obj = event.data.object as Stripe.PaymentIntent | Stripe.Checkout.Session;
        const md = (obj.metadata ?? {}) as Record<string, string>;
        if (md.kind === 'invoice' && md.invoiceId && md.schoolId) {
          // Checkout.Session has amount_total; PaymentIntent has amount. Both
          // are in the smallest currency unit (cents). Stripe may deliver either
          // event first, and the unique stripePaymentIntentId index keeps the
          // second one from creating a duplicate Payment row.
          const amountCents =
            'amount_total' in obj && obj.amount_total
              ? obj.amount_total
              : 'amount' in obj && typeof obj.amount === 'number'
                ? obj.amount
                : 0;
          const paymentIntentId =
            'payment_intent' in obj && typeof obj.payment_intent === 'string'
              ? obj.payment_intent
              : 'id' in obj && obj.object === 'payment_intent'
                ? obj.id
                : undefined;
          await markInvoicePaid(platform, {
            invoiceId: md.invoiceId,
            schoolId: md.schoolId,
            amountCents,
            stripePaymentIntentId: paymentIntentId,
            stripeEventId: event.id,
          });
        }
        break;
      }
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted': {
        const sub = event.data.object as Stripe.Subscription;
        const customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer.id;
        const md = (sub.metadata ?? {}) as Record<string, string>;
        const schoolId = md.schoolId;
        if (!schoolId) break;
        await platform.subscription.upsert({
          where: { schoolId },
          create: {
            schoolId,
            plan: (sub.items.data[0]?.price.nickname ?? 'unknown'),
            status: sub.status,
            stripeCustomerId: customerId,
            stripeSubscriptionId: sub.id,
            currentPeriodEnd: new Date(sub.current_period_end * 1000),
            cancelAtPeriodEnd: sub.cancel_at_period_end,
          },
          update: {
            status: sub.status,
            stripeCustomerId: customerId,
            stripeSubscriptionId: sub.id,
            currentPeriodEnd: new Date(sub.current_period_end * 1000),
            cancelAtPeriodEnd: sub.cancel_at_period_end,
          },
        });
        // PAST_DUE → suspend school after 14d would run as a cron (Phase 7).
        break;
      }
      default:
        // unhandled → 200 OK so Stripe stops retrying
        break;
    }
    return { received: true };
  }
}

async function markInvoicePaid(
  platform: ReturnType<typeof getPlatformPrisma>,
  args: { invoiceId: string; schoolId: string; amountCents: number; stripePaymentIntentId?: string; stripeEventId: string },
) {
  // Replay protection: insert Payment.stripeEventId — duplicate → quietly noop.
  try {
    await platform.$transaction(async (tx) => {
      const invoice = await tx.invoice.findUnique({ where: { id: args.invoiceId } });
      if (!invoice || invoice.schoolId !== args.schoolId) return;
      const amount = args.amountCents / 100;
      await tx.payment.create({
        data: {
          schoolId: args.schoolId,
          invoiceId: args.invoiceId,
          amount,
          method: 'CARD',
          stripePaymentIntentId: args.stripePaymentIntentId,
          stripeEventId: args.stripeEventId,
        },
      });
      const totalPaid = Number(invoice.amountPaid) + amount;
      const due = Number(invoice.amountDue);
      const status = totalPaid >= due ? 'PAID' : totalPaid > 0 ? 'PARTIAL' : 'OPEN';
      await tx.invoice.update({
        where: { id: args.invoiceId },
        data: { amountPaid: totalPaid, status },
      });
    });
  } catch (e) {
    // Unique constraint on stripeEventId → already processed.
    if ((e as { code?: string }).code === 'P2002') return;
    throw e;
  }
}
