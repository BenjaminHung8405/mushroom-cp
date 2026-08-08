import {
  Body,
  ConflictException,
  Controller,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
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
import { CreateDeviceDto, UpdateDeviceDto } from './dto/admin-devices.dto';

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

  @Get()
  async list() {
    const deviceList = await this.devices.find({ order: { createdAt: 'ASC' } });
    const houseList = await this.houses.find();
    const houseMap = new Map(houseList.map((h) => [h.id, h.name]));

    const userList = await this.users.find();
    const userMap = new Map(userList.map((u) => [u.id, u.phoneNumber]));

    const now = Date.now();

    const data = deviceList.map((device) => {
      let onlineStatus: 'online' | 'offline' | 'unconnected' = 'unconnected';
      if (device.lastSeenAt) {
        const diffSec = (now - new Date(device.lastSeenAt).getTime()) / 1000;
        onlineStatus = diffSec <= 60 ? 'online' : 'offline';
      }

      return {
        deviceId: device.deviceId,
        displayName: device.displayName,
        houseId: device.houseId,
        houseName: houseMap.get(device.houseId) ?? device.houseId,
        ownerUserId: device.ownerUserId,
        ownerPhone: userMap.get(device.ownerUserId) ?? device.ownerUserId,
        enabled: device.enabled,
        lastSeenAt: device.lastSeenAt,
        createdAt: device.createdAt,
        onlineStatus,
      };
    });

    return {
      data,
      meta: {
        total: data.length,
        page: 1,
        limit: 100,
      },
    };
  }

  @Post()
  async create(
    @Body() dto: CreateDeviceDto,
    @CurrentUser() actor: AuthPrincipal,
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
        ownerUserId: dto.ownerUserId ?? 'operator-001',
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
      { ipAddress: null, userAgent: null },
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
      dto.enabled === false && wasEnabled ? 'DEVICE_DISABLED' : 'DEVICE_UPDATED',
      actor.id,
      device.deviceId,
      { ipAddress: null, userAgent: null },
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
      { ipAddress: null, userAgent: null },
      'SUCCESS',
    );

    return {
      deviceId: device.deviceId,
      rawToken, // Returned ONCE
    };
  }
}
