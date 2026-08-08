import { BadRequestException, Body, Controller, Delete, Get, Headers, HttpCode, Patch, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { Public } from '../security/public.decorator';
import { AuthService } from './auth.service';
import { CurrentUser } from './auth.decorators';
import { SetPinDto } from './dto/set-pin.dto';
import { LoginDto } from './dto/login.dto';
import { PinLoginDto } from './dto/pin-login.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import type { AuthPrincipal } from './auth.types';
import { SESSION_COOKIE_NAME, SESSION_MAX_AGE_MS } from './auth.types';
import { RequestTokenDto } from './dto/request-token.dto';
import { Throttle } from '@nestjs/throttler';


@Controller()
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('auth/login') @Public() @Throttle({ default: { limit: 20, ttl: 60_000 } }) @HttpCode(200)
  async login(@Body() dto: LoginDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    // Auto-generate a human-readable device label from User-Agent when the client
    // provides a deviceToken. This surfaces in admin device management dashboards.
    const deviceLabel = dto.deviceToken
      ? (dto.deviceLabel ?? this.labelFromUserAgent(req.get('user-agent') ?? ''))
      : undefined;

    const result = await this.auth.login(dto.phoneNumber, dto.pin, {
      ipAddress: req.ip ?? null,
      userAgent: req.get('user-agent') ?? null,
    }, dto.deviceToken, deviceLabel);
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


  // POST /auth/pin/setup has been removed.
  // Device registration now happens automatically inside POST /auth/login
  // when the client provides an optional deviceToken field.


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

  @Get('auth/me') getMe(@CurrentUser() principal: AuthPrincipal | undefined) {
    if (!principal) throw new BadRequestException('Chưa đăng nhập.');
    return this.publicUser(principal);
  }

  @Patch('auth/profile')
  @HttpCode(200)
  async updateProfile(
    @CurrentUser() principal: AuthPrincipal,
    @Body() dto: UpdateProfileDto,
  ) {
    const updatedUser = await this.auth.updateProfile(principal.id, dto);
    principal.fullName = updatedUser.fullName;
    principal.avatar = updatedUser.avatar;
    return this.publicUser(principal);
  }

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

  /**
   * Extracts a short human-readable label from a User-Agent string.
   * e.g. "Mozilla/5.0 (iPad; CPU OS 17_0...) Safari/604.1" → "Safari on iPad"
   */
  private labelFromUserAgent(ua: string): string {
    if (!ua) return 'Unknown Device';
    const browser =
      /Edg\//.test(ua) ? 'Edge' :
      /OPR\//.test(ua) ? 'Opera' :
      /Chrome\//.test(ua) ? 'Chrome' :
      /Firefox\//.test(ua) ? 'Firefox' :
      /Safari\//.test(ua) ? 'Safari' : 'Browser';
    const os =
      /iPad/.test(ua) ? 'iPad' :
      /iPhone/.test(ua) ? 'iPhone' :
      /Android/.test(ua) ? 'Android Tablet' :
      /Windows/.test(ua) ? 'Windows' :
      /Macintosh/.test(ua) ? 'Mac' :
      /Linux/.test(ua) ? 'Linux' : 'Device';
    return `${browser} on ${os}`.slice(0, 150);
  }

  private publicUser(principal: AuthPrincipal | undefined) {
    if (!principal) return null;
    return {
      id: principal.id,
      phoneNumber: principal.phoneNumber,
      fullName: principal.fullName ?? null,
      avatar: principal.avatar ?? 'sprout',
      role: principal.role,
      houseIds: principal.houseIds,
      mustSetPin: principal.mustSetPin,
    };
  }
}
