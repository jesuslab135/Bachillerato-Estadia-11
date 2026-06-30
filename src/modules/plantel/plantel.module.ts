import { Body, Controller, Get, HttpCode, HttpStatus, Injectable, Module, Post } from '@nestjs/common';
import { IsOptional, IsString, MinLength } from 'class-validator';
import { Plantel } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CurrentUser, Roles } from '../../auth/decorators';
import { JwtPayload } from '../../auth/auth.types';

class CreatePlantelDto {
  @IsString() @MinLength(1) clave!: string;
  @IsString() @MinLength(1) nombre!: string;
  @IsOptional() @IsString() direccion?: string;
}

@Injectable()
export class PlantelService {
  constructor(private readonly prisma: PrismaService) {}

  // El Operador ve todos los planteles; los demás solo el suyo (RF-AUTH-03).
  findAll(user: JwtPayload): Promise<Plantel[]> {
    if (user.rol === 'Operador') return this.prisma.plantel.findMany({ orderBy: { clave: 'asc' } });
    return this.prisma.plantel.findMany({ where: { id: user.plantelId ?? '__none__' } });
  }

  create(dto: CreatePlantelDto): Promise<Plantel> {
    return this.prisma.plantel.create({ data: dto });
  }
}

@Controller('planteles')
export class PlantelController {
  constructor(private readonly planteles: PlantelService) {}

  @Get()
  findAll(@CurrentUser() user: JwtPayload) {
    return this.planteles.findAll(user);
  }

  // RF-CAT-01: se agregan más planteles sin redespliegue (solo Operador global).
  @Roles('Operador')
  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(@Body() dto: CreatePlantelDto) {
    return this.planteles.create(dto);
  }
}

@Module({
  controllers: [PlantelController],
  providers: [PlantelService],
})
export class PlantelModule {}
