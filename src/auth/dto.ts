import { IsEmail, IsString, MinLength } from 'class-validator';

export class LoginDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(1)
  password!: string;
}

export class ChangePasswordDto {
  @IsString()
  @MinLength(1)
  actual!: string;

  @IsString()
  @MinLength(8)
  nueva!: string;
}

export class DesbloquearDto {
  @IsEmail()
  email!: string;
}
