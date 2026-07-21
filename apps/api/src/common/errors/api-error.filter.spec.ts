import { BadRequestException, NotFoundException, ArgumentsHost } from '@nestjs/common';
import { ApiError } from './api-error';
import { ApiErrorFilter } from './api-error.filter';

function mockHost() {
  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });
  const response = { status };
  const host = {
    switchToHttp: () => ({
      getResponse: () => response,
      getRequest: () => ({}),
    }),
  } as unknown as ArgumentsHost;
  return { host, status, json };
}

describe('ApiErrorFilter', () => {
  let filter: ApiErrorFilter;

  beforeEach(() => {
    filter = new ApiErrorFilter();
  });

  it('passes an ApiError through as its own envelope + status', () => {
    const { host, status, json } = mockHost();
    filter.catch(new ApiError('CLASS_NOT_EMPTY', 'Class still has students', 409), host);

    expect(status).toHaveBeenCalledWith(409);
    expect(json).toHaveBeenCalledWith({ code: 'CLASS_NOT_EMPTY', message: 'Class still has students' });
  });

  it('normalizes a ValidationPipe BadRequestException to VALIDATION with a field', () => {
    const { host, status, json } = mockHost();
    filter.catch(
      new BadRequestException({
        statusCode: 400,
        message: ['email must be an email'],
        error: 'Bad Request',
      }),
      host,
    );

    expect(status).toHaveBeenCalledWith(400);
    expect(json).toHaveBeenCalledWith({
      code: 'VALIDATION',
      message: 'email must be an email',
      field: 'email',
    });
  });

  it('normalizes a plain HttpException (404) with a sensible code', () => {
    const { host, status, json } = mockHost();
    filter.catch(new NotFoundException('Student not found'), host);

    expect(status).toHaveBeenCalledWith(404);
    expect(json).toHaveBeenCalledWith({ code: 'NOT_FOUND', message: 'Student not found' });
  });

  it('normalizes an unknown Error to a flat INTERNAL 500 without leaking internals', () => {
    const { host, status, json } = mockHost();
    const spy = jest.spyOn((filter as unknown as { logger: { error: (m: string) => void } }).logger, 'error')
      .mockImplementation(() => undefined);

    filter.catch(new Error('some raw db connection string leak'), host);

    expect(status).toHaveBeenCalledWith(500);
    expect(json).toHaveBeenCalledWith({ code: 'INTERNAL', message: 'Something went wrong' });
    expect(spy).toHaveBeenCalled();
  });
});
