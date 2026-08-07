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

  @Get() async list() { return (await this.users.find({ order: { createdAt: 'ASC' } })).map((user) => this.publicUser(user)); }
  @Post() async create(@Body() dto: CreateUserDto, @CurrentUser() actor: AuthPrincipal) {
    const email = this.auth.normalizeEmail(dto.email);
    if (await this.users.exists({ where: { email } })) throw new ConflictException('Email already exists.');
    const user = await this.users.save(this.users.create({ email, passwordHash: await this.auth.hashPassword(dto.password), role: dto.role, isActive: true, mustChangePassword: true }));
    await this.auth.record('USER_CREATED', actor.id, email, { ipAddress: null, userAgent: null }, 'SUCCESS', { userId: user.id, role: user.role });
    return this.publicUser(user);
  }
  @Patch(':id') async update(@Param('id') id: string, @Body() dto: UpdateUserDto, @CurrentUser() actor: AuthPrincipal) {
    const user = await this.users.findOneBy({ id }); if (!user) throw new NotFoundException('User not found.');
    const changed = dto.role !== undefined && dto.role !== user.role || dto.isActive !== undefined && dto.isActive !== user.isActive;
    if (dto.email) user.email = this.auth.normalizeEmail(dto.email);
    if (dto.role) user.role = dto.role;
    if (dto.isActive !== undefined) user.isActive = dto.isActive;
    await this.users.save(user); if (changed) await this.auth.revokeAllUserSessions(user.id, 'USER_ACCESS_CHANGED');
    await this.auth.record('USER_UPDATED', actor.id, user.email, { ipAddress: null, userAgent: null }, 'SUCCESS', { userId: user.id });
    return this.publicUser(user);
  }
  @Post(':id/reset-password') async reset(@Param('id') id: string, @Body() dto: Pick<CreateUserDto, 'password'>, @CurrentUser() actor: AuthPrincipal): Promise<void> {
    const user = await this.users.findOneBy({ id }); if (!user) throw new NotFoundException('User not found.');
    user.passwordHash = await this.auth.hashPassword(dto.password); user.mustChangePassword = true; await this.users.save(user); await this.auth.revokeAllUserSessions(user.id, 'PASSWORD_RESET'); await this.auth.record('PASSWORD_RESET', actor.id, user.email, { ipAddress: null, userAgent: null }, 'SUCCESS');
  }
  @Put(':id/house-access') async replaceAccess(@Param('id') id: string, @Body() dto: HouseAccessDto, @CurrentUser() actor: AuthPrincipal): Promise<void> {
    const user = await this.users.findOneBy({ id }); if (!user) throw new NotFoundException('User not found.');
    await this.access.manager.transaction(async (manager) => { await manager.delete(UserHouseAccess, { userId: id }); if (dto.houseIds.length) await manager.insert(UserHouseAccess, dto.houseIds.map((houseId) => ({ userId: id, houseId }))); });
    await this.auth.revokeAllUserSessions(id, 'USER_SCOPE_CHANGED'); await this.auth.record('USER_SCOPE_CHANGED', actor.id, user.email, { ipAddress: null, userAgent: null }, 'SUCCESS', { userId: id, houseCount: dto.houseIds.length });
  }
  private publicUser(user: User) { return { id: user.id, email: user.email, role: user.role, isActive: user.isActive, mustChangePassword: user.mustChangePassword, createdAt: user.createdAt }; }
}
