import { IsBoolean, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

// La clave es la llave natural del catálogo y no se modifica vía update.
export class UpdateMateriaDto {
  @IsOptional()
  @IsString()
  nombre?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(6)
  semestreAplicable?: number;

  @IsOptional()
  @IsBoolean()
  activo?: boolean;
}
