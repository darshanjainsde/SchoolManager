import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { BlockThreadDto, ReportMessageDto } from './messages.dto';

const errorsFor = async <T extends object>(cls: new () => T, body: object) =>
  (await validate(plainToInstance(cls, body))).map((e) => e.property);

describe('ReportMessageDto', () => {
  it('accepts a reason of 1..500 characters, with or without a message id', async () => {
    expect(await errorsFor(ReportMessageDto, { reason: 'x' })).toEqual([]);
    expect(await errorsFor(ReportMessageDto, { reason: 'x'.repeat(500) })).toEqual([]);
    expect(await errorsFor(ReportMessageDto, { reason: 'rude', messageId: '99999999-9999-4999-8999-999999999999' })).toEqual([]);
  });

  it('rejects an empty, missing, non-string or over-500 reason', async () => {
    expect(await errorsFor(ReportMessageDto, { reason: '' })).toEqual(['reason']);
    expect(await errorsFor(ReportMessageDto, {})).toEqual(['reason']);
    expect(await errorsFor(ReportMessageDto, { reason: 42 })).toEqual(['reason']);
    expect(await errorsFor(ReportMessageDto, { reason: 'x'.repeat(501) })).toEqual(['reason']);
  });

  it('rejects a message id that is not a uuid', async () => {
    expect(await errorsFor(ReportMessageDto, { reason: 'rude', messageId: 'm1' })).toEqual(['messageId']);
  });
});

describe('BlockThreadDto', () => {
  it('needs a real boolean', async () => {
    expect(await errorsFor(BlockThreadDto, { blocked: true })).toEqual([]);
    expect(await errorsFor(BlockThreadDto, { blocked: false })).toEqual([]);
    expect(await errorsFor(BlockThreadDto, { blocked: 'true' })).toEqual(['blocked']);
    expect(await errorsFor(BlockThreadDto, {})).toEqual(['blocked']);
  });
});
