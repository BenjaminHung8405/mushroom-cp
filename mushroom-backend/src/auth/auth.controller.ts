import { BadRequestException, Body, Controller, Delete, Get, Headers, HttpCode, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { Public } from '../security/public.decorator';
import { AuthService } from './auth.service';
import { CurrentUser } from './auth.decorators';
import { SetPinDto } from './dto/set-pin.dto';
import { LoginDto } from './dto/login.dto';
import { PinSetupDto } from './dto/pin-setup.dto';
import { PinLoginDto } from './dto/pin-login.dto';
import type { AuthPrincipal } from './auth.types';
import { SESSION_COOKIE_NAME, SESSION_MAX_AGE_MS } from './auth.types';
import { RequestTokenDto } from './dto/request-token.dto';
import { Throttle } from '@nestjs/throttler';


@Controller()
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('auth/login') @Public() @Throttle({ default: { limit: 20, ttl: 60_000 } }) @HttpCode(200)
  async login(@Body() dto: LoginDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const result = await this.auth.login(dto.phoneNumber, dto.pin, {
      ipAddress: req.ip ?? null,
      userAgent: req.get('user-agent') ?? null,
    });
    res.cookie(SESSION_COOKIE_NAME, result.token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: SESSION_MAX_AGE_MS,
    });
    res.setHeader('Cache-Control', 'no-store');
    return { user: this.publicUser(result.principal) };
  }

  @Post('auth/pin/setup')
  @HttpCode(204)
  async setupPin(
    @CurrentUser() principal: AuthPrincipal,
    @Body() dto: PinSetupDto,
  ): Promise<void> {
    await this.auth.setupDevicePin(
      principal,
      dto.currentPin,
      dto.newPinForDevice,
      dto.deviceToken,
      dto.deviceLabel,
    );
  }

  @Post('auth/pin/login')
  @Public()
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @HttpCode(200)
  async pinLogin(
    @Body() dto: PinLoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.auth.loginWithDevicePin(dto.phoneNumber, dto.pin, dto.deviceToken, {
      ipAddress: req.ip ?? null,
      userAgent: req.get('user-agent') ?? null,
    });
    res.cookie(SESSION_COOKIE_NAME, result.token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: SESSION_MAX_AGE_MS,
    });
    res.setHeader('Cache-Control', 'no-store');
    return { user: this.publicUser(result.principal) };
  }

  @Delete('auth/pin/device')
  @HttpCode(204)
  async revokePinDevice(
    @CurrentUser() principal: AuthPrincipal,
    @Headers('x-device-token') deviceToken: string,
  ): Promise<void> {
    if (!deviceToken) throw new BadRequestException('X-Device-Token header is required');
    await this.auth.revokeDevicePin(principal, deviceToken);
  }


  @Post('auth/logout') @HttpCode(204)
  async logout(
    @CurrentUser() principal: AuthPrincipal,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    await this.auth.logout(principal.sessionId, principal.id);
    res.clearCookie(SESSION_COOKIE_NAME, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
    });
    res.setHeader('Cache-Control', 'no-store');
  }

  @Get('auth/me') getMe(@CurrentUser() principal: AuthPrincipal) { return this.publicUser(principal); }

  @Post('auth/set-pin') @HttpCode(204)
  async setPin(
    @CurrentUser() principal: AuthPrincipal,
    @Body() dto: SetPinDto,
  ): Promise<void> {
    await this.auth.setPin(principal, dto.currentPin, dto.newPin);
  }

  // ---------------------------------------------------------------------------
  // Legacy device bootstrap endpoints — remain public and separate from operator auth.
  // ---------------------------------------------------------------------------
  @Post('auth/token') @Public() @Throttle({ default: { limit: 5, ttl: 60_000 } }) @HttpCode(200)
  issueToken(@Body() body: RequestTokenDto) { return this.auth.issueDeviceToken(body.clientId, body.mqttUser); }

  @Get('v1/auth/device-token') @Public()
  issueDeviceToken(@Headers('x-device-id') deviceId: string) {
    if (!deviceId) throw new BadRequestException('X-Device-Id header is required');
    return this.auth.issueDeviceToken(deviceId);
  }

  private publicUser(principal: AuthPrincipal) {
    return {
      id: principal.id,
      phoneNumber: principal.phoneNumber,
      role: principal.role,
      houseIds: principal.houseIds,
      mustSetPin: principal.mustSetPin,
    };
  }
}
