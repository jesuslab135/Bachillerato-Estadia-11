import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Injectable,
  Module,
  Param,
  Post,
} from '@nestjs/common';
import { IsDateString, IsString, MinLength } from 'class-validator';
import { Periodo } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CurrentUser, Roles } from '../../auth/decorators';
import { JwtPayload } from '../../auth/auth.types';
import { aseguraAccesoPlantel, filtroPlantel } from '../../common/scope';

class CreatePeriodoDto {
  @IsString() @MinLength(1) plantelId!: string;
  @IsString() @MinLength(1) codigo!: string;
  @IsDateString() fechaInicio!: string;
  @IsDateString() fechaFin!: string;
}

@Injectable()
export class PeriodoService {
  constructor(private readonly prisma: PrismaService) {}

  findAll(user: JwtPayload): Promise<Periodo[]> {
    return this.prisma.periodo.findMany({ where: filtroPlantel(user), orderBy: { codigo: 'asc' } });
  }

  create(user: JwtPayload, dto: CreatePeriodoDto): Promise<Periodo> {
    aseguraAccesoPlantel(user, dto.plantelId);
    return this.prisma.periodo.create({
      data: {
        plantelId: dto.plantelId,
        codigo: dto.codigo,
        fechaInicio: new Date(dto.fechaInicio),
        fechaFin: new Date(dto.fechaFin),
        activo: false,
      },
    });
  }

  /**
   * RF-CAT-04 — Activar un periodo desactiva el anterior del mismo plantel.
   * Se hace en transacción para no violar el índice único parcial (un activo/plantel).
   */
  async activar(user: JwtPayload, id: string): Promise<Periodo> {
    const periodo = await this.prisma.periodo.findUniqueOrThrow({ where: { id } });
    aseguraAccesoPlantel(user, periodo.plantelId);
    const [, activado] = await this.prisma.$transaction([
      this.prisma.periodo.updateMany({
        where: { plantelId: periodo.plantelId, activo: true },
        data: { activo: false },
      }),
      this.prisma.periodo.update({ where: { id }, data: { activo: true } }),
    ]);
    return activado;
  }
}

@Controller('periodos')
export class PeriodoController {
  constructor(private readonly periodos: PeriodoService) {}

  @Get()
  findAll(@CurrentUser() user: JwtPayload) {
    return this.periodos.findAll(user);
  }

  @Roles('Coordinador', 'Operador')
  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(@CurrentUser() user: JwtPayload, @Body() dto: CreatePeriodoDto) {
    return this.periodos.create(user, dto);
  }

  @Roles('Coordinador', 'Operador')
  @Post(':id/activar')
  @HttpCode(HttpStatus.OK)
  activar(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.periodos.activar(user, id);
  }
}

@Module({
  controllers: [PeriodoController],
  providers: [PeriodoService],
})
export class PeriodoModule {}
