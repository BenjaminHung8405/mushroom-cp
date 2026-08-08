import { validate } from 'class-validator';
import { LoginDto } from './login.dto';
import { PinLoginDto } from './pin-login.dto';
import { CreateUserDto } from './create-user.dto';
import { UpdateUserDto } from './update-user.dto';
import { UserRole } from '../entities/user.entity';

describe('Auth DTOs — Phone Number Format Validation', () => {
  describe('LoginDto', () => {
    it('accepts local Vietnamese phone number starting with 0 (e.g. 0901234567)', async () => {
      const dto = new LoginDto();
      dto.phoneNumber = '0901234567';
      dto.pin = '123456';

      const errors = await validate(dto);
      expect(errors.length).toBe(0);
    });

    it('accepts E.164 format starting with +84 (e.g. +84901234567)', async () => {
      const dto = new LoginDto();
      dto.phoneNumber = '+84901234567';
      dto.pin = '123456';

      const errors = await validate(dto);
      expect(errors.length).toBe(0);
    });

    it('rejects invalid phone numbers (e.g. non-numeric or wrong length)', async () => {
      const dto = new LoginDto();
      dto.phoneNumber = '090123456'; // 9 digits instead of 10
      dto.pin = '123456';

      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0].property).toBe('phoneNumber');
    });
  });

  describe('PinLoginDto', () => {
    it('accepts local phone number starting with 0 (e.g. 0901234567)', async () => {
      const dto = new PinLoginDto();
      dto.phoneNumber = '0901234567';
      dto.pin = '123456';
      dto.deviceToken = '123e4567-e89b-42d3-a456-426614174000';

      const errors = await validate(dto);
      expect(errors.length).toBe(0);
    });
  });

  describe('CreateUserDto', () => {
    it('accepts local phone number starting with 0 (e.g. 0901234567)', async () => {
      const dto = new CreateUserDto();
      dto.phoneNumber = '0901234567';
      dto.pin = '123456';
      dto.role = UserRole.OPERATOR;

      const errors = await validate(dto);
      expect(errors.length).toBe(0);
    });
  });

  describe('UpdateUserDto', () => {
    it('accepts local phone number starting with 0 (e.g. 0901234567)', async () => {
      const dto = new UpdateUserDto();
      dto.phoneNumber = '0901234567';

      const errors = await validate(dto);
      expect(errors.length).toBe(0);
    });
  });
});
