import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  RawBodyRequest,
  Req,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import { ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { AuthUser, CurrentUser } from '../auth/decorators/current-user.decorator';
import { Public } from '../auth/decorators/public.decorator';
import { UploadFile } from './providers/didit-api.service';
import { KycDecisionDto, KycSubmitDto } from './dto/kyc.dto';
import { KycService } from './kyc.service';

type MulterFile = { buffer: Buffer; originalname: string; mimetype: string };
const first = (f?: MulterFile[]): UploadFile | undefined => f?.[0];

@ApiTags('kyc')
@Controller('kyc')
export class KycController {
  constructor(private readonly kyc: KycService) {}

  @Get('status')
  @ApiOperation({ summary: 'Estado KYC del usuario' })
  status(@CurrentUser() user: AuthUser) {
    return this.kyc.getStatus(user.sub);
  }

  @Post('submit')
  @ApiOperation({ summary: 'Envía datos + documento (MRZ) para verificación' })
  submit(@CurrentUser() user: AuthUser, @Body() dto: KycSubmitDto) {
    return this.kyc.submit(user.sub, dto);
  }

  @Post('session')
  @ApiOperation({ summary: 'Inicia una sesión hospedada de Didit (cámara con guías + óvalo)' })
  session(@CurrentUser() user: AuthUser, @Body() body: { fullName?: string }) {
    return this.kyc.startSession(user.sub, body?.fullName);
  }

  @Post('verify-documents')
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Verificación server-to-server (sube documento + selfie)' })
  @UseInterceptors(
    FileFieldsInterceptor([
      { name: 'front_image', maxCount: 1 },
      { name: 'back_image', maxCount: 1 },
      { name: 'selfie', maxCount: 1 },
    ]),
  )
  verifyDocuments(
    @CurrentUser() user: AuthUser,
    @UploadedFiles()
    files: { front_image?: MulterFile[]; back_image?: MulterFile[]; selfie?: MulterFile[] },
    @Body('fullName') fullName?: string,
  ) {
    return this.kyc.verifyWithDocuments(
      user.sub,
      {
        front: first(files?.front_image),
        back: first(files?.back_image),
        selfie: first(files?.selfie),
      },
      fullName,
    );
  }

  // Webhook server-to-server de Didit (sin auth/CSRF: se valida por firma HMAC).
  @Public()
  @Post('webhook/didit')
  @ApiOperation({ summary: 'Webhook de Didit con el resultado de la verificación' })
  diditWebhook(@Req() req: Request, @Body() body: Record<string, unknown>) {
    return this.kyc.handleDiditWebhook(body, req.headers);
  }

  // Webhook del KYC NATIVO (zentto-kyc): firma HMAC-SHA256 sobre el body crudo.
  @Public()
  @Post('webhook/zentto')
  @ApiOperation({ summary: 'Webhook de Zentto KYC (verificación nativa)' })
  zenttoWebhook(@Req() req: RawBodyRequest<Request>) {
    return this.kyc.handleZenttoWebhook(req.rawBody ?? Buffer.from(''), req.headers);
  }

  // ⚠️ OPERADOR (backoffice): cola de revisión. Pendiente de role-gating real.
  @Get('pending')
  @ApiOperation({ summary: 'Operador: verificaciones en cola de revisión' })
  pending() {
    return this.kyc.listPending();
  }

  // ⚠️ Endpoint de OPERADOR (backoffice). Pendiente de role-gating real
  // (hoy cualquier usuario autenticado; en prod restringir a rol operator).
  @Post(':id/decision')
  @ApiOperation({ summary: 'Operador: aprueba o rechaza una verificación en revisión' })
  decide(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: KycDecisionDto) {
    return this.kyc.decide(id, dto.approve, user.sub, dto.reason);
  }
}
