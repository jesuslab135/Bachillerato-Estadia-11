import { Body, Controller, Get, HttpCode, HttpStatus, Injectable, Module, Post } from '@nestjs/common';
import { IsInt, IsString, Max, Min, MinLength } from 'class-validator';
import { Grupo } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CurrentUser, Roles } from '../../auth/decorators';
import { JwtPayload } from '../../auth/auth.types';
import { aseguraAccesoPlantel, filtroPlantel } from '../../common/scope';

class CreateGrupoDto {
  @IsString() @MinLength(1) plantelId!: string;
  @IsString() @MinLength(1) nombre!: string;
  @IsInt() @Min(1) @Max(6) semestre!: number;
}

@Injectable()
export class GrupoService {
  constructor(private readonly prisma: PrismaService) {}

  findAll(user: JwtPayload): Promise<Grupo[]> {
    return this.prisma.grupo.findMany({
      where: filtroPlantel(user),
      orderBy: [{ semestre: 'asc' }, { nombre: 'asc' }],
    });
  }

  create(user: JwtPayload, dto: CreateGrupoDto): Promise<Grupo> {
    aseguraAccesoPlantel(user, dto.plantelId);
    return this.prisma.grupo.create({ data: dto });
  }
}

@Controller('grupos')
export class GrupoController {
  constructor(private readonly grupos: GrupoService) {}

  @Get()
  findAll(@CurrentUser() user: JwtPayload) {
    return this.grupos.findAll(user);
  }

  @Roles('Coordinador', 'Operador')
  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(@CurrentUser() user: JwtPayload, @Body() dto: CreateGrupoDto) {
    return this.grupos.create(user, dto);
  }
}

@Module({
  controllers: [GrupoController],
  providers: [GrupoService],
})
export class GrupoModule {}
