import { Transform } from 'class-transformer';
import { IsBoolean, IsInt, IsOptional, Max, Min } from 'class-validator';

export class QueryMateriaDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(6)
  semestre?: number;

  // Por defecto el listado excluye las materias dadas de baja lógica.
  // FB-B-7: transform explícito sobre el valor CRUDO (obj[key]) — con
  // enableImplicitConversion, `value` ya llega coaccionado y Boolean("false") === true.
  @IsOptional()
  @Transform(({ obj, key }) => (obj as Record<string, unknown>)[key] === true || (obj as Record<string, unknown>)[key] === 'true')
  @IsBoolean()
  incluirInactivas?: boolean;
}
