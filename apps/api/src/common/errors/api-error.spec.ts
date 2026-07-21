import { ApiError } from './api-error';

describe('ApiError', () => {
  it('serializes to the envelope with a field', () => {
    const e = new ApiError('DUPLICATE_ADMISSION_NO', 'Admission no. already exists', 409, 'admissionNo');
    expect(e.getStatus()).toBe(409);
    expect(e.getResponse()).toEqual({
      code: 'DUPLICATE_ADMISSION_NO',
      message: 'Admission no. already exists',
      field: 'admissionNo',
    });
  });

  it('omits field entirely when not supplied', () => {
    const e = new ApiError('NOT_FOUND', 'Class not found', 404);
    expect(e.getStatus()).toBe(404);
    const body = e.getResponse();
    expect(body).toEqual({ code: 'NOT_FOUND', message: 'Class not found' });
    expect(body).not.toHaveProperty('field');
  });
});
