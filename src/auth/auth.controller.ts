import { Body, Controller, HttpCode, HttpStatus, Post, Req } from '@nestjs/common';
import { AuthService } from './auth.service';
import { AllowWhileMustChange, CurrentUser, Public, Roles } from './decorators';
import { ChangePasswordDto, DesbloquearDto, LoginDto } from './dto';
import { JwtPayload } from './auth.types';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  login(@Body() dto: LoginDto, @Req() req: { ip?: string }) {
    return this.auth.login(dto.email, dto.password, req.ip ?? null);
  }

  @AllowWhileMustChange()
  @Post('change-password')
  @HttpCode(HttpStatus.OK)
  changePassword(@CurrentUser() user: JwtPayload, @Body() dto: ChangePasswordDto) {
    return this.auth.changePassword(user.sub, dto.actual, dto.nueva);
  }

  @Roles('Coordinador', 'Operador')
  @Post('desbloquear')
  @HttpCode(HttpStatus.OK)
  desbloquear(@CurrentUser() user: JwtPayload, @Body() dto: DesbloquearDto) {
    return this.auth.desbloquear(dto.email, user.sub);
  }
}
