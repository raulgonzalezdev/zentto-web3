import { Body, Controller, Get, Patch, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthUser, CurrentUser } from '../auth/decorators/current-user.decorator';
import { UsersService } from './users.service';

@ApiTags('users')
@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get('search')
  @ApiOperation({ summary: 'Buscar destinatarios por correo, teléfono o id' })
  search(@CurrentUser() user: AuthUser, @Query('q') q = '') {
    return this.users.search(q, user.sub);
  }

  @Patch('me')
  @ApiOperation({ summary: 'Actualizar mi nombre y/o teléfono' })
  updateMe(@CurrentUser() user: AuthUser, @Body() body: { displayName?: string; phone?: string }) {
    return this.users.updateProfile(user.sub, body ?? {});
  }
}
