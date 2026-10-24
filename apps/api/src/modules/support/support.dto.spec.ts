import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { CreateTicketDto, LookInDto, PatchTicketDto } from './support.dto';

const good = { type: 'BUG', module: 'FEES', severity: 'BLOCKING', title: 'Receipt PDF fails', body: 'Pressing Print receipt shows an error.' };

describe('CreateTicketDto, as a multipart form sends it', () => {
  it('reads the checkbox string as a boolean', () => {
    expect(plainToInstance(CreateTicketDto, { ...good, allowLookIn: 'true' }).allowLookIn).toBe(true);
    expect(plainToInstance(CreateTicketDto, { ...good, allowLookIn: 'false' }).allowLookIn).toBe(false);
    expect(plainToInstance(CreateTicketDto, { ...good }).allowLookIn).toBeUndefined();
    expect(validateSync(plainToInstance(CreateTicketDto, { ...good, allowLookIn: 'true' }))).toEqual([]);
  });

  it('refuses a title over 120 characters and a module nobody listed', () => {
    expect(validateSync(plainToInstance(CreateTicketDto, { ...good, title: 'x'.repeat(121) })).map((e) => e.property)).toEqual(['title']);
    expect(validateSync(plainToInstance(CreateTicketDto, { ...good, module: 'PAYROLL' })).map((e) => e.property)).toEqual(['module']);
  });

  it('refuses a checkbox value that is neither yes nor no', () => {
    expect(validateSync(plainToInstance(CreateTicketDto, { ...good, allowLookIn: 'maybe' })).map((e) => e.property)).toEqual(['allowLookIn']);
  });
});

describe('the smaller bodies', () => {
  it('LookInDto takes a real boolean from JSON', () => {
    expect(validateSync(plainToInstance(LookInDto, { allow: false }))).toEqual([]);
    expect(validateSync(plainToInstance(LookInDto, {})).map((e) => e.property)).toEqual(['allow']);
  });

  it('PatchTicketDto lets null clear the reference and caps its length', () => {
    expect(validateSync(plainToInstance(PatchTicketDto, { externalRef: null }))).toEqual([]);
    expect(validateSync(plainToInstance(PatchTicketDto, { externalRef: '#412' }))).toEqual([]);
    expect(validateSync(plainToInstance(PatchTicketDto, { externalRef: 'x'.repeat(121) })).map((e) => e.property)).toEqual(['externalRef']);
  });
});
