import {
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { RequireRoles, CurrentUser } from './auth.decorators';
import type { AuthPrincipal } from './auth.types';
import { AuthService } from './auth.service';
import { UserRole } from './entities/user.entity';
import { UserHouseAccess } from './entities/user-house-access.entity';
import { MushroomHouse } from '../batch/entities/mushroom-house.entity';
import { Device } from '../device/entities/device.entity';
import { CreateHouseDto, UpdateHouseDto } from './dto/admin-houses.dto';

@Controller('admin/houses')
@RequireRoles(UserRole.ADMIN)
export class AdminHousesController {
  constructor(
    @InjectRepository(MushroomHouse)
    private readonly houses: Repository<MushroomHouse>,
    @InjectRepository(Device)
    private readonly devices: Repository<Device>,
    @InjectRepository(UserHouseAccess)
    private readonly access: Repository<UserHouseAccess>,
    private readonly auth: AuthService,
  ) {}

  @Get()
  async list() {
    const houseList = await this.houses.find({ order: { createdAt: 'ASC' } });

    // Get device counts per house
    const deviceCounts = await this.devices
      .createQueryBuilder('device')
      .select('device.house_id', 'houseId')
      .addSelect('COUNT(device.device_id)', 'count')
      .groupBy('device.house_id')
      .getRawMany<{ houseId: string; count: string }>();

    const deviceCountMap = new Map(
      deviceCounts.map((row) => [row.houseId, parseInt(row.count, 10)]),
    );

    // Get access counts per house
    const accessCounts = await this.access
      .createQueryBuilder('access')
      .select('access.house_id', 'houseId')
      .addSelect('COUNT(access.user_id)', 'count')
      .groupBy('access.house_id')
      .getRawMany<{ houseId: string; count: string }>();

    const accessCountMap = new Map(
      accessCounts.map((row) => [row.houseId, parseInt(row.count, 10)]),
    );

    const data = houseList.map((house) => ({
      id: house.id,
      name: house.name,
      areaMeters: house.areaMeters,
      pillarCount: house.pillarCount,
      createdAt: house.createdAt,
      deviceCount: deviceCountMap.get(house.id) ?? 0,
      activeUserCount: accessCountMap.get(house.id) ?? 0,
    }));

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
    @Body() dto: CreateHouseDto,
    @CurrentUser() actor: AuthPrincipal,
  ) {
    if (await this.houses.exists({ where: { id: dto.id } })) {
      throw new ConflictException(`Nhà nấm có Mã '${dto.id}' đã tồn tại.`);
    }

    const house = await this.houses.save(
      this.houses.create({
        id: dto.id,
        name: dto.name,
        areaMeters: dto.areaMeters ?? '4x6',
        pillarCount: dto.pillarCount ?? 35,
      }),
    );

    await this.auth.record(
      'HOUSE_CREATED',
      actor.id,
      house.id,
      { ipAddress: null, userAgent: null },
      'SUCCESS',
      {
        name: house.name,
        areaMeters: house.areaMeters,
        pillarCount: house.pillarCount,
      },
    );

    return house;
  }

  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateHouseDto,
    @CurrentUser() actor: AuthPrincipal,
  ) {
    const house = await this.houses.findOneBy({ id });
    if (!house) {
      throw new NotFoundException(`Nhà nấm '${id}' không tồn tại.`);
    }

    if (dto.name !== undefined) house.name = dto.name;
    if (dto.areaMeters !== undefined) house.areaMeters = dto.areaMeters;
    if (dto.pillarCount !== undefined) house.pillarCount = dto.pillarCount;

    await this.houses.save(house);

    await this.auth.record(
      'HOUSE_UPDATED',
      actor.id,
      house.id,
      { ipAddress: null, userAgent: null },
      'SUCCESS',
      { changes: dto },
    );

    return house;
  }

  @Delete(':id')
  async delete(@Param('id') id: string, @CurrentUser() actor: AuthPrincipal) {
    const house = await this.houses.findOneBy({ id });
    if (!house) {
      throw new NotFoundException(`Nhà nấm '${id}' không tồn tại.`);
    }

    const deviceCount = await this.devices.count({ where: { houseId: id } });
    if (deviceCount > 0) {
      throw new ConflictException(
        `Không thể xóa Nhà nấm này vì còn ${deviceCount} thiết bị đang hoạt động. Hãy gán thiết bị sang nhà nấm khác trước.`,
      );
    }

    await this.houses.delete({ id });

    await this.auth.record(
      'HOUSE_DELETED',
      actor.id,
      id,
      { ipAddress: null, userAgent: null },
      'SUCCESS',
    );

    return { message: `Đã xóa nhà nấm '${id}' thành công.` };
  }
}
