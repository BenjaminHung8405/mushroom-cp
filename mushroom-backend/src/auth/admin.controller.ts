import { Body, ConflictException, Controller, Get, NotFoundException, Param, Patch, Post, Put } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { RequireRoles, CurrentUser } from './auth.decorators';
import type { AuthPrincipal } from './auth.types';
import { AuthService } from './auth.service';
import { CreateUserDto } from './dto/create-user.dto';
import { HouseAccessDto } from './dto/house-access.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { User, UserRole } from './entities/user.entity';
import { UserHouseAccess } from './entities/user-house-access.entity';

@Controller('admin/users')
@RequireRoles(UserRole.ADMIN)
export class AdminController {
  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(UserHouseAccess) private readonly access: Repository<UserHouseAccess>,
    private readonly auth: AuthService,
  ) {}

  @Get()
  async list() {
    return (await this.users.find({ order: { createdAt: 'ASC' } })).map((user) => this.publicUser(user));
  }

  @Post()
  async create(@Body() dto: CreateUserDto, @CurrentUser() actor: AuthPrincipal) {
    const phoneNumber = this.auth.normalizePhone(dto.phoneNumber);
    if (await this.users.exists({ where: { phoneNumber } })) {
      throw new ConflictException('Số điện thoại đã tồn tại.');
    }
    this.auth.validatePinStrength(dto.pin);
    const user = await this.users.save(
      this.users.create({
        phoneNumber,
        pinHash: await this.auth.hashPin(dto.pin),
        role: dto.role,
        isActive: true,
        mustSetPin: true, // User must change PIN on first login
      }),
    );
    await this.auth.record('USER_CREATED', actor.id, phoneNumber, { ipAddress: null, userAgent: null }, 'SUCCESS', {
      userId: user.id,
      role: user.role,
    });
    return this.publicUser(user);
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() dto: UpdateUserDto, @CurrentUser() actor: AuthPrincipal) {
    const user = await this.users.findOneBy({ id });
    if (!user) throw new NotFoundException('Người dùng không tồn tại.');

    const changed =
      (dto.role !== undefined && dto.role !== user.role) ||
      (dto.isActive !== undefined && dto.isActive !== user.isActive);

    if (dto.phoneNumber) user.phoneNumber = this.auth.normalizePhone(dto.phoneNumber);
    if (dto.role) user.role = dto.role;
    if (dto.isActive !== undefined) user.isActive = dto.isActive;

    // Inline PIN reset via PATCH (convenience for admins)
    if (dto.newPin) {
      this.auth.validatePinStrength(dto.newPin);
      user.pinHash = await this.auth.hashPin(dto.newPin);
      user.mustSetPin = true;
      user.pinFailedAttempts = 0;
      user.pinLockedUntil = null;
    }

    await this.users.save(user);
    if (changed || dto.newPin) await this.auth.revokeAllUserSessions(user.id, 'USER_ACCESS_CHANGED');
    await this.auth.record('USER_UPDATED', actor.id, user.phoneNumber, { ipAddress: null, userAgent: null }, 'SUCCESS', {
      userId: user.id,
    });
    return this.publicUser(user);
  }

  @Post(':id/reset-pin')
  async resetPin(
    @Param('id') id: string,
    @Body() dto: Pick<CreateUserDto, 'pin'>,
    @CurrentUser() actor: AuthPrincipal,
  ): Promise<void> {
    const user = await this.users.findOneBy({ id });
    if (!user) throw new NotFoundException('Người dùng không tồn tại.');
    await this.auth.adminResetPin(id, dto.pin, actor.id);
  }

  @Put(':id/house-access')
  async replaceAccess(
    @Param('id') id: string,
    @Body() dto: HouseAccessDto,
    @CurrentUser() actor: AuthPrincipal,
  ): Promise<void> {
    const user = await this.users.findOneBy({ id });
    if (!user) throw new NotFoundException('Người dùng không tồn tại.');
    await this.access.manager.transaction(async (manager) => {
      await manager.delete(UserHouseAccess, { userId: id });
      if (dto.houseIds.length) {
        await manager.insert(UserHouseAccess, dto.houseIds.map((houseId) => ({ userId: id, houseId })));
      }
    });
    await this.auth.revokeAllUserSessions(id, 'USER_SCOPE_CHANGED');
    await this.auth.record('USER_SCOPE_CHANGED', actor.id, user.phoneNumber, { ipAddress: null, userAgent: null }, 'SUCCESS', {
      userId: id,
      houseCount: dto.houseIds.length,
    });
  }

  private publicUser(user: User) {
    return {
      id: user.id,
      phoneNumber: user.phoneNumber,
      role: user.role,
      isActive: user.isActive,
      mustSetPin: user.mustSetPin,
      pinLockedUntil: user.pinLockedUntil,
      createdAt: user.createdAt,
    };
  }
}
