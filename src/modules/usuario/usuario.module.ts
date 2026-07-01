import { Controller, Get, Injectable, Module, Query } from '@nestjs/common';
import { RolUsuario } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CurrentUser, Roles } from '../../auth/decorators';
import { JwtPayload } from '../../auth/auth.types';
import { filtroPlantel } from '../../common/scope';

const ROLES: RolUsuario[] = ['Docente', 'Coordinador', 'Operador'];

@Injectable()
export class UsuarioService {
  constructor(private readonly prisma: PrismaService) {}

  /** Lista usuarios del plantel (Operador = global), opcionalmente por rol. Sin exponer el hash. */
  listar(user: JwtPayload, rol?: RolUsuario) {
    return this.prisma.usuario.findMany({
      where: { ...filtroPlantel(user), ...(rol && ROLES.includes(rol) ? { rol } : {}) },
      select: { id: true, nombreCompleto: true, email: true, rol: true, plantelId: true, activo: true },
      orderBy: { nombreCompleto: 'asc' },
    });
  }
}

@Controller('usuarios')
export class UsuarioController {
  constructor(private readonly usuarios: UsuarioService) {}

  @Roles('Coordinador', 'Operador')
  @Get()
  listar(@CurrentUser() user: JwtPayload, @Query('rol') rol?: RolUsuario) {
    return this.usuarios.listar(user, rol);
  }
}

@Module({
  controllers: [UsuarioController],
  providers: [UsuarioService],
})
export class UsuarioModule {}
