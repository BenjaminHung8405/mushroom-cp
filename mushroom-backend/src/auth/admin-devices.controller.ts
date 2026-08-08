import {
  Body,
  ConflictException,
  Controller,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { randomBytes } from 'crypto';
import { RequireRoles, CurrentUser } from './auth.decorators';
import type { AuthPrincipal } from './auth.types';
import { AuthService } from './auth.service';
import { User, UserRole } from './entities/user.entity';
import { MushroomHouse } from '../batch/entities/mushroom-house.entity';
import { Device } from '../device/entities/device.entity';
import { DeviceRegistryService } from '../device/device-registry.service';
import { MqttService } from '../mqtt/mqtt.service';
import {
  CreateDeviceDto,
  ListDevicesQueryDto,
  UpdateDeviceDto,
} from './dto/admin-devices.dto';

@Controller('admin/devices')
@RequireRoles(UserRole.ADMIN)
export class AdminDevicesController {
  constructor(
    @InjectRepository(Device)
    private readonly devices: Repository<Device>,
    @InjectRepository(MushroomHouse)
    private readonly houses: Repository<MushroomHouse>,
    @InjectRepository(User)
    private readonly users: Repository<User>,
    private readonly auth: AuthService,
    private readonly deviceRegistryService: DeviceRegistryService,
    private readonly mqttService: MqttService,
  ) {}

  private extractContext(req?: Request) {
    if (!req) return { ipAddress: null, userAgent: null };
    const rawIp =
      (req.headers?.['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
      req.ip ||
      null;
    const userAgent = (req.headers?.['user-agent'] as string) || null;
    return { ipAddress: rawIp, userAgent };
  }

  @Get()
  async list(@Query() query?: ListDevicesQueryDto) {
    const page = query?.page ?? 1;
    const limit = query?.limit ?? 50;
    const offset = (page - 1) * limit;

    const total = await this.devices.count();

    const qb = this.devices
      .createQueryBuilder('device')
      .leftJoin(MushroomHouse, 'house', 'house.id = device.houseId')
      .leftJoin(User, 'user', 'user.id = device.ownerUserId')
      .select([
        'device.deviceId AS "deviceId"',
        'device.displayName AS "displayName"',
        'device.houseId AS "houseId"',
        'house.name AS "houseName"',
        'device.ownerUserId AS "ownerUserId"',
        'user.phoneNumber AS "ownerPhone"',
        'device.enabled AS "enabled"',
        'device.lastSeenAt AS "lastSeenAt"',
        'device.createdAt AS "createdAt"',
      ])
      .orderBy('device.createdAt', 'ASC');

    const rawDevices = await qb.offset(offset).limit(limit).getRawMany();

    const now = Date.now();

    const data = rawDevices.map((device) => {
      let onlineStatus: 'online' | 'offline' | 'unconnected' = 'unconnected';
      if (device.lastSeenAt) {
        const diffSec = (now - new Date(device.lastSeenAt).getTime()) / 1000;
        onlineStatus = diffSec <= 60 ? 'online' : 'offline';
      }

      return {
        deviceId: device.deviceId,
        displayName: device.displayName,
        houseId: device.houseId,
        houseName: device.houseName ?? device.houseId,
        ownerUserId: device.ownerUserId,
        ownerPhone: device.ownerPhone ?? null,
        enabled: device.enabled,
        lastSeenAt: device.lastSeenAt,
        createdAt: device.createdAt,
        onlineStatus,
      };
    });

    return {
      data,
      meta: {
        total,
        page,
        limit,
      },
    };
  }

  @Post()
  async create(
    @Body() dto: CreateDeviceDto,
    @CurrentUser() actor: AuthPrincipal,
    @Req() req: Request,
  ) {
    if (await this.devices.exists({ where: { deviceId: dto.deviceId } })) {
      throw new ConflictException(`Thiết bị '${dto.deviceId}' đã tồn tại.`);
    }

    const house = await this.houses.findOneBy({ id: dto.houseId });
    if (!house) {
      throw new NotFoundException(`Nhà nấm '${dto.houseId}' không tồn tại.`);
    }

    const rawToken = randomBytes(32).toString('hex');

    const device = await this.devices.save(
      this.devices.create({
        deviceId: dto.deviceId,
        houseId: dto.houseId,
        ownerUserId: dto.ownerUserId ?? null,
        displayName: dto.displayName ?? null,
        mqttUsername: dto.deviceId,
        token: rawToken,
        enabled: true,
      }),
    );

    await this.deviceRegistryService.refreshOne(device.deviceId);

    await this.auth.record(
      'DEVICE_CREATED',
      actor.id,
      device.deviceId,
      this.extractContext(req),
      'SUCCESS',
      { houseId: device.houseId, ownerUserId: device.ownerUserId },
    );

    return {
      deviceId: device.deviceId,
      displayName: device.displayName,
      houseId: device.houseId,
      ownerUserId: device.ownerUserId,
      enabled: device.enabled,
      rawToken, // Returned ONCE to display to admin
      createdAt: device.createdAt,
    };
  }

  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateDeviceDto,
    @CurrentUser() actor: AuthPrincipal,
    @Req() req: Request,
  ) {
    const device = await this.devices.findOneBy({ deviceId: id });
    if (!device) {
      throw new NotFoundException(`Thiết bị '${id}' không tồn tại.`);
    }

    if (dto.houseId) {
      const house = await this.houses.findOneBy({ id: dto.houseId });
      if (!house) {
        throw new NotFoundException(`Nhà nấm '${dto.houseId}' không tồn tại.`);
      }
      device.houseId = dto.houseId;
    }

    if (dto.displayName !== undefined) device.displayName = dto.displayName;
    if (dto.ownerUserId !== undefined) device.ownerUserId = dto.ownerUserId;

    const wasEnabled = device.enabled;
    if (dto.enabled !== undefined) device.enabled = dto.enabled;

    await this.devices.save(device);
    await this.deviceRegistryService.refreshOne(device.deviceId);

    if (wasEnabled && dto.enabled === false) {
      // Kick MQTT session immediately
      await this.mqttService.kickDevice(device.deviceId);
    }

    await this.auth.record(
      dto.enabled === false && wasEnabled
        ? 'DEVICE_DISABLED'
        : 'DEVICE_UPDATED',
      actor.id,
      device.deviceId,
      this.extractContext(req),
      'SUCCESS',
      { changes: dto },
    );

    return {
      deviceId: device.deviceId,
      displayName: device.displayName,
      houseId: device.houseId,
      ownerUserId: device.ownerUserId,
      enabled: device.enabled,
      lastSeenAt: device.lastSeenAt,
      updatedAt: device.updatedAt,
    };
  }

  @Post(':id/token/regenerate')
  async regenerateToken(
    @Param('id') id: string,
    @CurrentUser() actor: AuthPrincipal,
    @Req() req: Request,
  ) {
    const device = await this.devices.findOneBy({ deviceId: id });
    if (!device) {
      throw new NotFoundException(`Thiết bị '${id}' không tồn tại.`);
    }

    const rawToken = randomBytes(32).toString('hex');
    device.token = rawToken;
    await this.devices.save(device);

    await this.auth.record(
      'DEVICE_TOKEN_REGENERATED',
      actor.id,
      device.deviceId,
      this.extractContext(req),
      'SUCCESS',
    );

    return {
      deviceId: device.deviceId,
      rawToken, // Returned ONCE
    };
  }
}
