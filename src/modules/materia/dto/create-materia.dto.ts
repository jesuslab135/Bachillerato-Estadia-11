import { IsBoolean, IsInt, IsOptional, IsString, Matches, Max, Min } from 'class-validator';

export class CreateMateriaDto {
  // Clave del catálogo, p. ej. "MAT-1", "FME-2". Mayúsculas, dígitos y guiones.
  @IsString()
  @Matches(/^[A-Z]{2,5}-\d{1,2}$/, { message: 'clave debe tener formato tipo "MAT-1"' })
  clave!: string;

  @IsString()
  nombre!: string;

  @IsInt()
  @Min(1)
  @Max(6)
  semestreAplicable!: number;

  @IsOptional()
  @IsBoolean()
  activo?: boolean;
}
