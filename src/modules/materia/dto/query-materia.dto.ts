import { IsBoolean, IsInt, IsOptional, Max, Min } from 'class-validator';

export class QueryMateriaDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(6)
  semestre?: number;

  // Por defecto el listado excluye las materias dadas de baja lógica.
  @IsOptional()
  @IsBoolean()
  incluirInactivas?: boolean;
}
