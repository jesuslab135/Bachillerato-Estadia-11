import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Injectable,
  Module,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import * as XLSX from 'xlsx';
import { IsArray, IsIn, IsOptional, IsString, MinLength } from 'class-validator';
import { EstatusCadete } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CurrentUser, Roles } from '../../auth/decorators';
import { JwtPayload } from '../../auth/auth.types';
import { aseguraAccesoPlantel, filtroPlantel } from '../../common/scope';
import { parseCsv } from '../../common/csv';

// Límite de tamaño para importación por archivo (FB-B-1). 2 MB es de sobra para un roster.
const MAX_IMPORT_BYTES = 2 * 1024 * 1024;

// FB-B-5 — verificación por firma (magic bytes), no solo por extensión.
const FIRMA_ZIP = [0x50, 0x4b, 0x03, 0x04]; // "PK\x03\x04": contenedor ZIP de un .xlsx

/** Un .xlsx real es un ZIP: debe empezar con la firma PK\x03\x04. */
function tieneFirmaXlsx(buffer: Buffer): boolean {
  return buffer.length >= FIRMA_ZIP.length && FIRMA_ZIP.every((b, i) => buffer[i] === b);
}

/** Un .csv debe ser texto: se rechaza contenido con bytes NUL (binario). */
function esTextoPlano(buffer: Buffer): boolean {
  return !buffer.subarray(0, 1024).includes(0);
}

// Archivo subido (subconjunto de Express.Multer.File; evita depender de @types/multer).
interface ArchivoSubido {
  originalname: string;
  buffer: Buffer;
  size: number;
  mimetype: string;
}

const ESTATUS: EstatusCadete[] = ['Activo', 'BajaTemporal', 'BajaDefinitiva'];
const CON_FECHA_BAJA: EstatusCadete[] = ['BajaTemporal', 'BajaDefinitiva'];

interface RegistroImport {
  matricula?: string;
  nombreCompleto?: string;
  grupoId?: string;
  estatus?: string;
}

class CrearCadeteDto {
  @IsString() @MinLength(1) matricula!: string;
  @IsString() @MinLength(1) nombreCompleto!: string;
  @IsString() @MinLength(1) grupoId!: string;
  @IsOptional() @IsIn(ESTATUS) estatus?: EstatusCadete;
}

class ActualizarCadeteDto {
  @IsOptional() @IsString() @MinLength(1) nombreCompleto?: string;
  @IsOptional() @IsString() @MinLength(1) grupoActualId?: string;
  @IsOptional() @IsIn(ESTATUS) estatus?: EstatusCadete;
}

class ImportCadetesDto {
  @IsOptional() @IsArray() registros?: RegistroImport[];
  @IsOptional() @IsString() csv?: string;
  // FB-B-2 — grupo aplicado a las filas SIN grupoId (la fila con grupoId propio tiene prioridad).
  @IsOptional() @IsString() grupoIdPorDefecto?: string;
}

interface ErrorImport {
  indice: number;
  matricula: string | null;
  motivo: string;
}

@Injectable()
export class CadeteService {
  constructor(private readonly prisma: PrismaService) {}

  listar(user: JwtPayload, grupoId?: string, estatus?: EstatusCadete) {
    return this.prisma.cadete.findMany({
      where: { ...filtroPlantel(user), ...(grupoId ? { grupoActualId: grupoId } : {}), ...(estatus ? { estatus } : {}) },
      orderBy: { nombreCompleto: 'asc' },
    });
  }

  async obtener(user: JwtPayload, matricula: string) {
    const cadete = await this.prisma.cadete.findUnique({ where: { matricula } });
    if (!cadete) throw new NotFoundException('Cadete no existe');
    aseguraAccesoPlantel(user, cadete.plantelId);
    return cadete;
  }

  private async grupoConAcceso(user: JwtPayload, grupoId: string) {
    const grupo = await this.prisma.grupo.findUnique({ where: { id: grupoId } });
    if (!grupo) throw new NotFoundException('Grupo no existe');
    aseguraAccesoPlantel(user, grupo.plantelId);
    return grupo;
  }

  async crear(user: JwtPayload, dto: CrearCadeteDto) {
    const grupo = await this.grupoConAcceso(user, dto.grupoId);
    const estatus = dto.estatus ?? 'Activo';
    return this.prisma.cadete.create({
      data: {
        matricula: dto.matricula,
        nombreCompleto: dto.nombreCompleto,
        plantelId: grupo.plantelId,
        grupoActualId: grupo.id,
        estatus,
        fechaBaja: CON_FECHA_BAJA.includes(estatus) ? new Date() : null,
      },
    });
  }

  async actualizar(user: JwtPayload, matricula: string, dto: ActualizarCadeteDto) {
    const cadete = await this.obtener(user, matricula);
    if (dto.grupoActualId) await this.grupoConAcceso(user, dto.grupoActualId);
    // RN-05: al pasar a baja se sella la fecha; al reactivar se limpia.
    const fechaBaja =
      dto.estatus === undefined ? undefined : CON_FECHA_BAJA.includes(dto.estatus) ? (cadete.fechaBaja ?? new Date()) : null;
    return this.prisma.cadete.update({
      where: { matricula },
      data: {
        nombreCompleto: dto.nombreCompleto,
        grupoActualId: dto.grupoActualId,
        estatus: dto.estatus,
        ...(fechaBaja === undefined ? {} : { fechaBaja }),
      },
    });
  }

  /** RF-CAT-07 — Importación con éxito parcial: valida por fila y no aborta las válidas. */
  async importar(user: JwtPayload, dto: ImportCadetesDto) {
    // FB-B-7: parser RFC 4180 compartido (comas dentro de comillas, comillas escapadas).
    const registros = dto.registros ?? (dto.csv ? (parseCsv(dto.csv) as RegistroImport[]) : []);
    const idsSolicitados = [...registros.map((r) => r.grupoId?.trim()), dto.grupoIdPorDefecto];
    const grupoIds = [...new Set(idsSolicitados.filter((g): g is string => !!g))];
    const grupos = new Map(
      (await this.prisma.grupo.findMany({ where: { id: { in: grupoIds } } })).map((g) => [g.id, g]),
    );
    const matriculas = registros.map((r) => r.matricula).filter((m): m is string => !!m);
    const existentes = new Set(
      (await this.prisma.cadete.findMany({ where: { matricula: { in: matriculas } }, select: { matricula: true } })).map((c) => c.matricula),
    );

    const errores: ErrorImport[] = [];
    const enLote = new Set<string>();
    const validos: { matricula: string; nombreCompleto: string; plantelId: string; grupoActualId: string; estatus: EstatusCadete }[] = [];

    registros.forEach((r, indice) => {
      const matricula = r.matricula?.trim() || null;
      const grupoId = r.grupoId?.trim() || dto.grupoIdPorDefecto; // la fila gana; si no, el grupo por defecto
      const push = (motivo: string) => errores.push({ indice, matricula, motivo });
      if (!matricula || !r.nombreCompleto?.trim() || !grupoId) return push('Campos requeridos: matricula, nombreCompleto, grupo');
      if (existentes.has(matricula) || enLote.has(matricula)) return push('Matrícula duplicada');
      const grupo = grupos.get(grupoId);
      if (!grupo) return push('Grupo inexistente');
      if (user.rol !== 'Operador' && grupo.plantelId !== user.plantelId) return push('Grupo de otro plantel');
      const estatus = (r.estatus?.trim() as EstatusCadete) || 'Activo';
      if (!ESTATUS.includes(estatus)) return push('Estatus inválido');
      enLote.add(matricula);
      validos.push({ matricula, nombreCompleto: r.nombreCompleto.trim(), plantelId: grupo.plantelId, grupoActualId: grupo.id, estatus });
    });

    if (validos.length > 0) {
      await this.prisma.cadete.createMany({
        data: validos.map((v) => ({ ...v, fechaBaja: CON_FECHA_BAJA.includes(v.estatus) ? new Date() : null })),
      });
    }
    return { insertados: validos.length, errores };
  }

  private parseXlsx(buffer: Buffer): RegistroImport[] {
    const wb = XLSX.read(buffer, { type: 'buffer' });
    const hoja = wb.Sheets[wb.SheetNames[0]];
    if (!hoja) return [];
    const filas = XLSX.utils.sheet_to_json<Record<string, unknown>>(hoja, { defval: '' });
    const txt = (v: unknown) => (v === null || v === undefined ? '' : String(v).trim());
    return filas.map((f) => ({
      matricula: txt(f.matricula),
      nombreCompleto: txt(f.nombreCompleto),
      grupoId: txt(f.grupoId),
      estatus: txt(f.estatus) || undefined,
    }));
  }

  /** RF-CAT-07 — Importación desde archivo subido (.csv o .xlsx), reutiliza `importar`. */
  async importarArchivo(user: JwtPayload, file: ArchivoSubido | undefined, grupoIdPorDefecto?: string) {
    if (!file) throw new BadRequestException('Archivo requerido (campo "archivo")');
    if (file.size > MAX_IMPORT_BYTES) throw new BadRequestException('El archivo excede 2 MB');
    const nombre = file.originalname.toLowerCase();
    if (nombre.endsWith('.csv')) {
      // FB-B-5: la extensión filtra primero; la firma del contenido decide (no se parsea binario).
      if (!esTextoPlano(file.buffer)) throw new BadRequestException('El archivo .csv no es texto plano');
      return this.importar(user, { csv: file.buffer.toString('utf-8'), grupoIdPorDefecto });
    }
    if (nombre.endsWith('.xlsx')) {
      if (!tieneFirmaXlsx(file.buffer)) {
        throw new BadRequestException('El archivo no tiene la firma de un .xlsx válido');
      }
      return this.importar(user, { registros: this.parseXlsx(file.buffer), grupoIdPorDefecto });
    }
    throw new BadRequestException('Formato no soportado: usa un archivo .csv o .xlsx');
  }
}

@Controller('cadetes')
export class CadeteController {
  constructor(private readonly cadetes: CadeteService) {}

  @Get()
  listar(@CurrentUser() user: JwtPayload, @Query('grupoId') grupoId?: string, @Query('estatus') estatus?: EstatusCadete) {
    if (estatus && !ESTATUS.includes(estatus)) throw new BadRequestException('Estatus inválido');
    return this.cadetes.listar(user, grupoId, estatus);
  }

  @Get(':matricula')
  obtener(@CurrentUser() user: JwtPayload, @Param('matricula') matricula: string) {
    return this.cadetes.obtener(user, matricula);
  }

  @Roles('Coordinador', 'Operador')
  @Post()
  @HttpCode(HttpStatus.CREATED)
  crear(@CurrentUser() user: JwtPayload, @Body() dto: CrearCadeteDto) {
    return this.cadetes.crear(user, dto);
  }

  @Roles('Coordinador', 'Operador')
  @Post('import')
  @HttpCode(HttpStatus.CREATED)
  importar(@CurrentUser() user: JwtPayload, @Body() dto: ImportCadetesDto) {
    return this.cadetes.importar(user, dto);
  }

  @Roles('Coordinador', 'Operador')
  @Post('import/archivo')
  @HttpCode(HttpStatus.CREATED)
  // FB-B-5: multer corta el stream en el límite (no se bufferea un archivo mayor).
  @UseInterceptors(FileInterceptor('archivo', { limits: { fileSize: MAX_IMPORT_BYTES } }))
  importarArchivo(@CurrentUser() user: JwtPayload, @UploadedFile() file: ArchivoSubido, @Query('grupoId') grupoId?: string) {
    return this.cadetes.importarArchivo(user, file, grupoId);
  }

  @Roles('Coordinador', 'Operador')
  @Patch(':matricula')
  actualizar(@CurrentUser() user: JwtPayload, @Param('matricula') matricula: string, @Body() dto: ActualizarCadeteDto) {
    return this.cadetes.actualizar(user, matricula, dto);
  }
}

@Module({
  controllers: [CadeteController],
  providers: [CadeteService],
})
export class CadeteModule {}
