import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsOptional, IsString, Length, MaxLength, MinLength } from 'class-validator';

export class RegisterDto {
  @ApiProperty({ example: 'demo@zentto.net' })
  @IsEmail()
  email!: string;

  @ApiProperty({ example: 'SuperSecret123', minLength: 8 })
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password!: string;

  @ApiProperty({ required: false, example: 'Demo User' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  displayName?: string;
}

export class LoginDto {
  @ApiProperty({ example: 'demo@zentto.net' })
  @IsEmail()
  email!: string;

  @ApiProperty({ example: 'SuperSecret123' })
  @IsString()
  password!: string;
}

export class TwoFactorLoginDto {
  @ApiProperty({ description: 'Ticket MFA devuelto por /auth/login' })
  @IsString()
  mfaToken!: string;

  @ApiProperty({ example: '123456', description: 'Código TOTP de 6 dígitos' })
  @IsString()
  @Length(6, 6)
  code!: string;
}

export class TotpCodeDto {
  @ApiProperty({ example: '123456' })
  @IsString()
  @Length(6, 6)
  code!: string;
}

export class VerifyEmailDto {
  @ApiProperty({ description: 'Token recibido en el email de verificación' })
  @IsString()
  @MinLength(10)
  token!: string;
}

export class ForgotPasswordDto {
  @ApiProperty({ example: 'demo@zentto.net' })
  @IsEmail()
  email!: string;
}

export class ResetPasswordDto {
  @ApiProperty({ description: 'Token recibido en el email de restablecimiento' })
  @IsString()
  @MinLength(10)
  token!: string;

  @ApiProperty({ example: 'NuevaClave123', minLength: 8 })
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  newPassword!: string;
}
