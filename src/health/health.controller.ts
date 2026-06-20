import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { HealthCheck, HealthCheckService, TypeOrmHealthIndicator } from '@nestjs/terminus';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly db: TypeOrmHealthIndicator,
  ) {}

  @Get()
  @HealthCheck()
  @ApiOperation({
    summary: 'Liveness/readiness: comprueba la conectividad con la base de datos',
  })
  check() {
    // La dependencia crítica para readiness es la BD. El ping confirma que el
    // pool responde; es la señal fiable para el HEALTHCHECK del contenedor.
    return this.health.check([() => this.db.pingCheck('database', { timeout: 3000 })]);
  }
}
