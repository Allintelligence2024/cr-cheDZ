import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Query } from '@nestjs/common';
import { IsOptional, IsUUID } from 'class-validator';
import { CurrentUser, type CurrentUserPayload } from '../../shared/decorators/current-user.decorator';
import { Roles } from '../../shared/decorators/roles.decorator';
import { CreateRoomDto, UpdateRoomDto } from './dto/organizations.dto';
import { RoomsService } from './rooms.service';

class ListRoomsQuery {
  @IsOptional()
  @IsUUID()
  site_id?: string;
}

class RoomIdParam {
  @IsUUID()
  id!: string;
}

@Controller('rooms')
export class RoomsController {
  constructor(private readonly roomsService: RoomsService) {}

  @Get()
  async list(@Query() query: ListRoomsQuery): Promise<{ items: Array<Record<string, unknown>> }> {
    return { items: await this.roomsService.list(query.site_id) };
  }

  @Get(':id')
  async getById(@Param() params: RoomIdParam): Promise<Record<string, unknown>> {
    return this.roomsService.getById(params.id);
  }

  @Post()
  @Roles('super_admin', 'director')
  async create(
    @Body() dto: CreateRoomDto,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<Record<string, unknown>> {
    return this.roomsService.create(dto, user.sub);
  }

  @Patch(':id')
  @Roles('super_admin', 'director')
  async update(
    @Param() params: RoomIdParam,
    @Body() dto: UpdateRoomDto,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<Record<string, unknown>> {
    return this.roomsService.update(params.id, dto, user.sub);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Roles('super_admin', 'director')
  async deactivate(
    @Param() params: RoomIdParam,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<void> {
    await this.roomsService.deactivate(params.id, user.sub);
  }
}
