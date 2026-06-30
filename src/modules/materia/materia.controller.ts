import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { MateriaService } from './materia.service';
import { CreateMateriaDto } from './dto/create-materia.dto';
import { UpdateMateriaDto } from './dto/update-materia.dto';
import { QueryMateriaDto } from './dto/query-materia.dto';
import { Roles } from '../../auth/decorators';

// Lectura: cualquier usuario autenticado. Mutación de catálogo: solo
// Coordinador/Operador — un Docente no puede crear/editar catálogos (RF-CAT-06).
@Controller('materias')
export class MateriaController {
  constructor(private readonly materias: MateriaService) {}

  @Get()
  findAll(@Query() query: QueryMateriaDto) {
    return this.materias.findAll(query);
  }

  @Get(':clave')
  findOne(@Param('clave') clave: string) {
    return this.materias.findByClave(clave);
  }

  @Roles('Coordinador', 'Operador')
  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(@Body() dto: CreateMateriaDto) {
    return this.materias.create(dto);
  }

  @Roles('Coordinador', 'Operador')
  @Patch(':clave')
  update(@Param('clave') clave: string, @Body() dto: UpdateMateriaDto) {
    return this.materias.update(clave, dto);
  }

  @Roles('Coordinador', 'Operador')
  @Delete(':clave')
  remove(@Param('clave') clave: string) {
    return this.materias.softDelete(clave);
  }
}
