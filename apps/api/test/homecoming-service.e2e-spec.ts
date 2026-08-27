import { getPlatformPrisma, disconnectAll, withTenant } from '@skoolos/db';
import { AlumniService } from '../src/modules/alumni/internal/alumni.service';
import { GiftsService } from '../src/modules/alumni/internal/gifts.service';

/**
 * The service behaviours the audit found, pinned so they cannot come back.
 *
 * Each of these was a real defect in the first cut, and none of them would have
 * failed a type check or a unit test of the pure rules — they only appear once
 * a real row exists in a real database.
 */
describe('Homecoming services, against a real database', () => {
  // Every *ByUserId column is @db.Uuid, so a placeholder string is rejected by
  // the driver rather than the service. Use a real one — the JWT's `sub` always
  // is one, so a non-uuid here tests nothing that can happen.
  const ACTOR = '00000000-0000-4000-8000-0000000000ff';
  const alumni = new AlumniService();
  const gifts = new GiftsService();
  let schoolId: string;
  let sectionId: string;

  beforeAll(async () => {
    const p = getPlatformPrisma();
    const school = await p.school.upsert({
      where: { slug: 'hc-svc' },
      update: {},
      create: { slug: 'hc-svc', name: 'Service School', tier: 'PRO', status: 'LIVE' },
    });
    schoolId = school.id;

    const year = await p.academicYear.create({
      data: {
        schoolId,
        name: '26-27',
        startDate: new Date('2026-04-01'),
        endDate: new Date('2027-03-31'),
        isCurrent: true,
      },
    });
    // Grade is school-wide and carries no academic year; ClassSection is what
    // ties a grade to a year.
    const grade = await p.grade.create({ data: { schoolId, name: '12', order: 12 } });
    const section = await p.classSection.create({
      data: { schoolId, academicYearId: year.id, gradeId: grade.id, name: 'A' },
    });
    sectionId = section.id;

    for (let i = 1; i <= 3; i += 1) {
      await p.student.create({
        data: {
          schoolId,
          admissionNo: `A-${i}`,
          firstName: `Child${i}`,
          lastName: 'Test',
          classSectionId: sectionId,
          guardianPhone: `+9198000000${i}`,
        },
      });
    }
  });

  afterAll(async () => {
    await disconnectAll();
  });

  describe('graduating a batch', () => {
    it('creates one alumni row per child, carrying the record across', async () => {
      const r = await alumni.graduateBatch(schoolId, { classSectionIds: [sectionId], batchYear: 2026 });
      expect(r.created).toBe(3);
      expect(r.considered).toBe(3);
      expect(r.guardianPhonesOnFile).toBe(3);
    });

    it('never copies the guardian phone into the alumnus’s own phone field', async () => {
      const rows = await withTenant(schoolId, (tx) => tx.alumni.findMany({ where: { batchYear: 2026 } }));
      expect(rows).toHaveLength(3);
      expect(rows.every((a) => a.phone === null)).toBe(true);
    });

    it('is idempotent — pressing it twice gives the batch once, not twice', async () => {
      const again = await alumni.graduateBatch(schoolId, { classSectionIds: [sectionId], batchYear: 2026 });
      expect(again.created).toBe(0);
      expect(again.alreadyPresent).toBe(3);
      const count = await withTenant(schoolId, (tx) => tx.alumni.count({ where: { batchYear: 2026 } }));
      expect(count).toBe(3);
    });

    it('DERIVES the register strength rather than incrementing it', async () => {
      // The defect this pins: an increment double-counts as soon as anyone
      // types a strength in by hand before graduating the batch. 3 typed, then
      // 3 graduated, read as 6 — and Roll Call showed 50% coverage of a year
      // that was completely accounted for.
      await alumni.saveBatchStrength(schoolId, { batchYear: 2026, registerStrength: 3 });
      await alumni.graduateBatch(schoolId, { classSectionIds: [sectionId], batchYear: 2026 });
      const board = await alumni.rollCall(schoolId);
      const row = board.find((b) => b.batchYear === 2026)!;
      expect(row.registerStrength).toBe(3);
      expect(row.found).toBe(3);
      expect(row.coverage).toBe(100);
    });

    it('never lowers a strength typed in from the bound register', async () => {
      // A pre-Sckools year legitimately carries a strength far larger than the
      // handful of alumni found so far, and graduating must not overwrite it.
      await alumni.saveBatchStrength(schoolId, { batchYear: 2026, registerStrength: 81 });
      await alumni.graduateBatch(schoolId, { classSectionIds: [sectionId], batchYear: 2026 });
      const board = await alumni.rollCall(schoolId);
      expect(board.find((b) => b.batchYear === 2026)!.registerStrength).toBe(81);
    });

    it('reports coverage as null, not 100%, when no strength was ever recorded', async () => {
      const p = getPlatformPrisma();
      await p.alumni.create({
        data: { schoolId, firstName: 'Old', lastName: 'Boy', batchYear: 1975, status: 'VERIFIED' },
      });
      const board = await alumni.rollCall(schoolId);
      const row = board.find((b) => b.batchYear === 1975)!;
      expect(row.registerStrength).toBe(0);
      expect(row.coverage).toBeNull();
    });
  });

  describe('merging a claim', () => {
    it('refuses a merge into a record from a different batch year', async () => {
      const p = getPlatformPrisma();
      const target = await p.alumni.create({
        data: { schoolId, firstName: 'Real', lastName: 'Alum', batchYear: 2004, status: 'VERIFIED' },
      });
      const claim = await p.alumniClaim.create({
        data: { schoolId, firstName: 'Someone', lastName: 'Else', batchYear: 1998, proof: 'x', phone: '+919000000000' },
      });
      await expect(
        alumni.decideClaim(schoolId, claim.id, ACTOR, {
          action: 'VERIFY',
          mergeIntoAlumniId: target.id,
        }),
      ).rejects.toThrow(/Class of 2004/);

      // And nothing was written to the target on the way out.
      const after = await withTenant(schoolId, (tx) => tx.alumni.findUnique({ where: { id: target.id } }));
      expect(after!.phone).toBeNull();
    });

    it('keeps the ORIGINAL verifier when merging into an already-verified record', async () => {
      const p = getPlatformPrisma();
      const target = await p.alumni.create({
        data: {
          schoolId, firstName: 'Already', lastName: 'Verified', batchYear: 2009,
          status: 'VERIFIED', verifiedByUserId: '00000000-0000-4000-8000-00000000000a',
          verifiedAt: new Date('2026-03-04'),
        },
      });
      const claim = await p.alumniClaim.create({
        data: { schoolId, firstName: 'Already', lastName: 'Verified', batchYear: 2009, proof: 'x' },
      });
      await alumni.decideClaim(schoolId, claim.id, '00000000-0000-4000-8000-00000000000b', {
        action: 'VERIFY',
        mergeIntoAlumniId: target.id,
      });
      const after = await withTenant(schoolId, (tx) => tx.alumni.findUnique({ where: { id: target.id } }));
      // Whoever first matched this person against the register is the answer to
      // "who let them in". A later merge must not take the credit or the blame.
      expect(after!.verifiedByUserId).toBe('00000000-0000-4000-8000-00000000000a');
      expect(after!.verifiedAt).toEqual(new Date('2026-03-04'));
    });

    it('requires a reason to decline', async () => {
      const p = getPlatformPrisma();
      const claim = await p.alumniClaim.create({
        data: { schoolId, firstName: 'No', lastName: 'Proof', batchYear: 1992, proof: 'none' },
      });
      await expect(
        alumni.decideClaim(schoolId, claim.id, ACTOR, { action: 'DECLINE' }),
      ).rejects.toThrow(/reason/i);
    });
  });

  describe('the everyone-or-nobody rule, end to end', () => {
    let pledgeId: string;

    it('sets the quantity from the live headcount, not from the request', async () => {
      const item = await withTenant(schoolId, (tx) =>
        tx.giftItem.create({ data: { schoolId, name: 'Sweater', indicativeCostMinor: 38000 } }),
      );
      const pledge = await gifts.createPledge(schoolId, {
        donorName: 'A Donor',
        scopeKind: 'SECTION',
        classSectionId: sectionId,
        giftItemId: item.id,
        mode: 'SUPPLY',
      });
      pledgeId = pledge.id;
      expect(pledge.headcountAtPledge).toBe(3);
      expect(pledge.quantity).toBe(3);
      // SUPPLY carries no valuation — that is what keeps donated goods out of
      // the fee ledger and the valuation out of our hands.
      expect(pledge.amountMinor).toBeNull();
    });

    it('refuses to hand out a short pledge', async () => {
      await gifts.decide(schoolId, pledgeId, ACTOR, { action: 'ACCEPT' });
      const view = await gifts.receive(schoolId, pledgeId, ACTOR, { receivedQty: 2 });
      expect(view.short).toBe(1);
      expect(view.canDistribute).toBe(false);
      await expect(
        gifts.distribute(schoolId, pledgeId, ACTOR, { distributedQty: 2, absentQty: 1 }),
      ).rejects.toThrow(/Short by 1/);
    });

    it('hands it out once somebody closes the gap', async () => {
      const view = await gifts.receive(schoolId, pledgeId, ACTOR, { receivedQty: 1 });
      expect(view.received).toBe(3);
      expect(view.canDistribute).toBe(true);
      const done = await gifts.distribute(schoolId, pledgeId, ACTOR, { distributedQty: 2, absentQty: 1 });
      expect(done.status).toBe('DISTRIBUTED');
    });

    it('refuses a distribution whose numbers do not add up to the group', async () => {
      const item = await withTenant(schoolId, (tx) =>
        tx.giftItem.create({ data: { schoolId, name: 'Bag', indicativeCostMinor: 45000 } }),
      );
      const p2 = await gifts.createPledge(schoolId, {
        donorName: 'B', scopeKind: 'SECTION', classSectionId: sectionId,
        giftItemId: item.id, mode: 'FUND',
      });
      // FUND prices at the frozen headcount.
      expect(p2.amountMinor).toBe(45000 * 3);
      await gifts.decide(schoolId, p2.id, ACTOR, { action: 'ACCEPT' });
      await gifts.receive(schoolId, p2.id, ACTOR, { receivedQty: 3 });
      // Money has to be SPENT before there is anything to hand out. Skipping
      // this step would let a school report distributing something it had not
      // bought, which is why the funded track has it at all.
      await gifts.purchase(schoolId, p2.id, ACTOR, {});
      // 1 given + 1 absent = 2, but the group has 3. The third child is
      // unaccounted for, which is the divided classroom by another name.
      await expect(
        gifts.distribute(schoolId, p2.id, ACTOR, { distributedQty: 1, absentQty: 1 }),
      ).rejects.toThrow(/must equal 3/);
    });

    it('refuses a pledge to a group with no children in it', async () => {
      const p = getPlatformPrisma();
      const year = await p.academicYear.findFirst({ where: { schoolId } });
      const grade = await p.grade.create({ data: { schoolId, name: 'Empty', order: 99 } });
      const empty = await p.classSection.create({
        data: { schoolId, academicYearId: year!.id, gradeId: grade.id, name: 'Z' },
      });
      await expect(
        gifts.createPledge(schoolId, {
          donorName: 'C', scopeKind: 'SECTION', classSectionId: empty.id,
          customRequest: 'anything', mode: 'SUPPLY',
        }),
      ).rejects.toThrow(/no children/i);
    });
  });

  describe('trust revocation', () => {
    it('cancels scheduled sessions rather than merely preventing new ones', async () => {
      const p = getPlatformPrisma();
      const alum = await p.alumni.create({
        data: {
          schoolId, firstName: 'Guest', lastName: 'Speaker', batchYear: 2004,
          status: 'VERIFIED', trustedForStudents: true,
        },
      });
      await p.guestSession.create({
        data: {
          schoolId, alumniId: alum.id, title: 'Bridges', classSectionId: sectionId,
          headcountAtBooking: 3, requestedDate: new Date('2026-12-02'),
          requestedPeriodId: '00000000-0000-4000-8000-0000000000c1',
          status: 'SCHEDULED',
        },
      });

      const r = await alumni.setTrusted(schoolId, alum.id, ACTOR, { trusted: false, reason: 'withdrawn' });
      // A revocation that leaves a booking standing next Tuesday is not a
      // revocation. This is the single most important line in the module.
      expect(r.sessionsCancelled).toBe(1);
      const s = await withTenant(schoolId, (tx) => tx.guestSession.findFirst({ where: { alumniId: alum.id } }));
      expect(s!.status).toBe('CANCELLED');
      expect(s!.declineReason).toBe('withdrawn');
    });

    it('refuses to trust an alumnus nobody has verified', async () => {
      const p = getPlatformPrisma();
      const alum = await p.alumni.create({
        data: { schoolId, firstName: 'Un', lastName: 'Verified', batchYear: 2001, status: 'PENDING' },
      });
      await expect(
        alumni.setTrusted(schoolId, alum.id, ACTOR, { trusted: true }),
      ).rejects.toThrow(/verified/i);
    });
  });

  /**
   * "I am already registered — send me my link."
   *
   * The security property is not that it works. It is that the response is
   * IDENTICAL whether or not the contact belongs to anybody, so this cannot be
   * used to ask a school whether a given address is one of its alumni.
   */
  describe('requestLink', () => {
    let registered: string;

    beforeAll(async () => {
      const p = getPlatformPrisma();
      const al = await p.alumni.create({
        data: {
          schoolId, firstName: 'Farida', lastName: 'Sheikh', batchYear: 1998,
          status: 'VERIFIED', email: 'farida.sheikh@example.com', phone: '+919812345678',
        },
      });
      registered = al.id;
    });

    it('answers a stranger exactly as it answers a real alumnus', async () => {
      const hit = await alumni.requestLink(schoolId, { contact: 'farida.sheikh@example.com' });
      const miss = await alumni.requestLink(schoolId, { contact: 'nobody-at-all@example.com' });
      expect(hit).toEqual(miss);
      expect(hit).toEqual({ received: true });
    });

    it('files a request for the real alumnus and none for the stranger', async () => {
      const rows = await alumni.listLinkRequests(schoolId);
      expect(rows.map((r) => r.alumni.id)).toContain(registered);
      expect(rows).toHaveLength(1);
    });

    it('does not queue a second request when somebody taps it again', async () => {
      await alumni.requestLink(schoolId, { contact: 'farida.sheikh@example.com' });
      await alumni.requestLink(schoolId, { contact: '+919812345678' });
      const rows = await alumni.listLinkRequests(schoolId);
      expect(rows).toHaveLength(1);
    });

    it('ignores somebody the office has not verified', async () => {
      const p = getPlatformPrisma();
      await p.alumni.create({
        data: {
          schoolId, firstName: 'Pending', lastName: 'Person', batchYear: 1998,
          status: 'PENDING', email: 'pending.person@example.com',
        },
      });
      const r = await alumni.requestLink(schoolId, { contact: 'pending.person@example.com' });
      expect(r).toEqual({ received: true });
      const rows = await alumni.listLinkRequests(schoolId);
      expect(rows).toHaveLength(1); // still just Farida
    });

    it('closing a request takes it off the queue and lets a new one be filed', async () => {
      const [open] = await alumni.listLinkRequests(schoolId);
      await alumni.closeLinkRequest(schoolId, open.id, ACTOR, true);
      expect(await alumni.listLinkRequests(schoolId)).toHaveLength(0);
      await alumni.requestLink(schoolId, { contact: 'farida.sheikh@example.com' });
      expect(await alumni.listLinkRequests(schoolId)).toHaveLength(1);
    });
  });

  /**
   * The journey a donor actually watches.
   *
   * Every assertion here is about what the person who gave the money can see,
   * because that is the half of gifting that decides whether they give again.
   */
  describe('the gift journey', () => {
    const givingItem = async (name: string) =>
      withTenant(schoolId, (tx) =>
        tx.giftItem.create({ data: { schoolId, name, indicativeCostMinor: 30000 } }));

    it('walks a funded gift and records every step in the history', async () => {
      const item = await givingItem('Funded shoes');
      const p = await gifts.createPledge(schoolId, {
        donorName: 'Funder', scopeKind: 'SECTION', classSectionId: sectionId,
        giftItemId: item.id, mode: 'FUND', unitPriceMinor: 50000,
      });
      // What the donor typed beats the school's indicative cost.
      expect(p.unitPriceMinor).toBe(50000);
      expect(p.amountMinor).toBe(50000 * 3);

      await gifts.decide(schoolId, p.id, ACTOR, { action: 'ACCEPT' });
      await gifts.receive(schoolId, p.id, ACTOR, { receivedQty: 3 });
      await gifts.purchase(schoolId, p.id, ACTOR, {});
      await gifts.distribute(schoolId, p.id, ACTOR, { distributedQty: 3, absentQty: 0 });

      const events = await withTenant(schoolId, (tx) =>
        tx.giftEvent.findMany({ where: { pledgeId: p.id }, orderBy: { at: 'asc' } }));
      expect(events.map((e) => e.status)).toEqual([
        'ACCEPTED', 'RECEIVED', 'PURCHASED', 'DISTRIBUTED',
      ]);
    });

    it('walks a sent gift through collection, transit and arrival', async () => {
      const item = await givingItem('Sent blankets');
      const p = await gifts.createPledge(schoolId, {
        donorName: 'Sender', scopeKind: 'SECTION', classSectionId: sectionId,
        giftItemId: item.id, mode: 'SUPPLY',
        pickupAddress: '14 Residency Road, Pune', pickupContact: 'Watchman', pickupPhone: '+919812345678',
      });
      // No valuation is stored for goods, whatever the school's list says.
      expect(p.amountMinor).toBeNull();
      expect(p.unitPriceMinor).toBeNull();
      expect(p.pickupAddress).toContain('Residency Road');

      await gifts.decide(schoolId, p.id, ACTOR, { action: 'ACCEPT' });
      await gifts.requestPickup(schoolId, p.id, { userId: ACTOR }, {
        pickupAddress: '14 Residency Road, Pune', pickupContact: 'Watchman',
      });
      const moving = await gifts.markPickedUp(schoolId, p.id, { userId: ACTOR }, {
        courier: 'Delhivery', trackingRef: 'DL-99001',
      });
      expect(moving.status).toBe('PICKED_UP');
      expect(moving.trackingRef).toBe('DL-99001');
      expect(moving.pickedUpAt).not.toBeNull();

      await gifts.receive(schoolId, p.id, ACTOR, { receivedQty: 3 });
      await gifts.distribute(schoolId, p.id, ACTOR, { distributedQty: 3, absentQty: 0 });

      const events = await withTenant(schoolId, (tx) =>
        tx.giftEvent.findMany({ where: { pledgeId: p.id }, orderBy: { at: 'asc' } }));
      expect(events.map((e) => e.status)).toEqual([
        'ACCEPTED', 'PICKUP_REQUESTED', 'PICKED_UP', 'RECEIVED', 'DISTRIBUTED',
      ]);
    });

    it('refuses to arrange collection for a gift of money', async () => {
      const item = await givingItem('Money only');
      const p = await gifts.createPledge(schoolId, {
        donorName: 'F2', scopeKind: 'SECTION', classSectionId: sectionId,
        giftItemId: item.id, mode: 'FUND', unitPriceMinor: 10000,
      });
      await gifts.decide(schoolId, p.id, ACTOR, { action: 'ACCEPT' });
      await expect(
        gifts.requestPickup(schoolId, p.id, { userId: ACTOR }, { pickupAddress: 'Anywhere at all' }),
      ).rejects.toThrow(/money/i);
    });

    it('refuses a tracking reference with nobody carrying it', async () => {
      const item = await givingItem('Untracked');
      const p = await gifts.createPledge(schoolId, {
        donorName: 'S2', scopeKind: 'SECTION', classSectionId: sectionId,
        giftItemId: item.id, mode: 'SUPPLY',
      });
      await gifts.decide(schoolId, p.id, ACTOR, { action: 'ACCEPT' });
      await gifts.requestPickup(schoolId, p.id, { userId: ACTOR }, { pickupAddress: '1 Some Street' });
      await expect(
        gifts.markPickedUp(schoolId, p.id, { userId: ACTOR }, { trackingRef: 'ORPHAN-1' }),
      ).rejects.toThrow(/carrying/i);
    });

    it('lets a donor who drives it over skip collection entirely', async () => {
      const item = await givingItem('Hand delivered');
      const p = await gifts.createPledge(schoolId, {
        donorName: 'S3', scopeKind: 'SECTION', classSectionId: sectionId,
        giftItemId: item.id, mode: 'SUPPLY',
      });
      await gifts.decide(schoolId, p.id, ACTOR, { action: 'ACCEPT' });
      const r = await gifts.receive(schoolId, p.id, ACTOR, { receivedQty: 3 });
      expect(r.canDistribute).toBe(true);
    });

    it('will not let a donor touch somebody else’s pledge', async () => {
      const p = getPlatformPrisma();
      const other = await p.alumni.create({
        data: { schoolId, firstName: 'Some', lastName: 'Other', batchYear: 2001, status: 'VERIFIED' },
      });
      const item = await givingItem('Not yours');
      const pledge = await gifts.createPledge(schoolId, {
        donorName: 'S4', scopeKind: 'SECTION', classSectionId: sectionId,
        giftItemId: item.id, mode: 'SUPPLY',
      });
      await gifts.decide(schoolId, pledge.id, ACTOR, { action: 'ACCEPT' });
      // Reported as not-found rather than forbidden: whether a pledge exists is
      // itself information about somebody else's giving.
      await expect(
        gifts.requestPickup(schoolId, pledge.id, { alumniId: other.id }, { pickupAddress: '9 Elsewhere Road' }),
      ).rejects.toThrow(/not found/i);
    });

    it('refuses to thank somebody for a gift nobody has accepted', async () => {
      const item = await givingItem('Unaccepted');
      const p = await gifts.createPledge(schoolId, {
        donorName: 'S5', scopeKind: 'SECTION', classSectionId: sectionId,
        giftItemId: item.id, mode: 'SUPPLY',
      });
      await expect(
        gifts.thankYou(schoolId, p.id, ACTOR, { note: 'Thank you so much for this.' }),
      ).rejects.toThrow(/accept/i);
    });

    it('lets the school write a note without moving the pledge', async () => {
      const item = await givingItem('Thanked');
      const p = await gifts.createPledge(schoolId, {
        donorName: 'S6', scopeKind: 'SECTION', classSectionId: sectionId,
        giftItemId: item.id, mode: 'SUPPLY',
      });
      await gifts.decide(schoolId, p.id, ACTOR, { action: 'ACCEPT' });
      const after = await gifts.thankYou(schoolId, p.id, ACTOR, {
        note: 'The children were delighted — thank you for thinking of them.',
      });
      // A thank you is not a stage of a workflow.
      expect(after.status).toBe('ACCEPTED');
      expect(after.thankYouAt).not.toBeNull();
    });

    it('gives the donor a summary that counts children, not rupees', async () => {
      const p = getPlatformPrisma();
      const donor = await p.alumni.create({
        data: { schoolId, firstName: 'Counted', lastName: 'Donor', batchYear: 2002, status: 'VERIFIED' },
      });
      const item = await givingItem('Summed');
      const pledge = await gifts.createPledge(schoolId, {
        alumniId: donor.id, scopeKind: 'SECTION', classSectionId: sectionId,
        giftItemId: item.id, mode: 'SUPPLY',
      });
      let summary = await gifts.givingSummary(schoolId, donor.id);
      expect(summary.gifts).toBe(1);
      expect(summary.childrenReached).toBe(0); // nothing has reached anybody yet
      expect(summary.inFlight).toBe(1);

      await gifts.decide(schoolId, pledge.id, ACTOR, { action: 'ACCEPT' });
      await gifts.receive(schoolId, pledge.id, ACTOR, { receivedQty: 3 });
      await gifts.distribute(schoolId, pledge.id, ACTOR, { distributedQty: 3, absentQty: 0 });

      summary = await gifts.givingSummary(schoolId, donor.id);
      expect(summary.childrenReached).toBe(3);
      expect(summary.inFlight).toBe(0);
    });

    it('leaves a cancelled gift out of the summary entirely', async () => {
      const p = getPlatformPrisma();
      const donor = await p.alumni.create({
        data: { schoolId, firstName: 'Changed', lastName: 'Mind', batchYear: 2003, status: 'VERIFIED' },
      });
      const item = await givingItem('Withdrawn');
      const pledge = await gifts.createPledge(schoolId, {
        alumniId: donor.id, scopeKind: 'SECTION', classSectionId: sectionId,
        giftItemId: item.id, mode: 'SUPPLY',
      });
      await gifts.decide(schoolId, pledge.id, ACTOR, { action: 'CANCEL' });
      const summary = await gifts.givingSummary(schoolId, donor.id);
      expect(summary.gifts).toBe(0);
    });
  });
});
