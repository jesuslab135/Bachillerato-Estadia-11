import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, Materia } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateMateriaDto } from './dto/create-materia.dto';
import { UpdateMateriaDto } from './dto/update-materia.dto';
import { QueryMateriaDto } from './dto/query-materia.dto';

@Injectable()
export class MateriaService {
  constructor(private readonly prisma: PrismaService) {}

  findAll(query: QueryMateriaDto): Promise<Materia[]> {
    const where: Prisma.MateriaWhereInput = {};
    if (query.semestre !== undefined) where.semestreAplicable = query.semestre;
    if (!query.incluirInactivas) where.activo = true;
    return this.prisma.materia.findMany({ where, orderBy: [{ semestreAplicable: 'asc' }, { clave: 'asc' }] });
  }

  async findByClave(clave: string): Promise<Materia> {
    const materia = await this.prisma.materia.findUnique({ where: { clave } });
    if (!materia) throw new NotFoundException(`Materia con clave "${clave}" no existe`);
    return materia;
  }

  async create(dto: CreateMateriaDto): Promise<Materia> {
    try {
      return await this.prisma.materia.create({ data: dto });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException(`Ya existe una materia con clave "${dto.clave}"`);
      }
      throw e;
    }
  }

  async update(clave: string, dto: UpdateMateriaDto): Promise<Materia> {
    await this.findByClave(clave);
    return this.prisma.materia.update({ where: { clave }, data: dto });
  }

  // Borrado lógico (RF-CAT-06): no se elimina la fila, se marca inactiva.
  async softDelete(clave: string): Promise<Materia> {
    await this.findByClave(clave);
    return this.prisma.materia.update({ where: { clave }, data: { activo: false } });
  }
}
