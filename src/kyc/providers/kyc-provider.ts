/** Resultado de iniciar una sesión de verificación con el proveedor de liveness. */
export interface ProviderSession {
  /** Referencia de la sesión en el proveedor (null en modo manual). */
  ref: string | null;
  /** URL a la que enviar al usuario para el liveness (null en modo manual). */
  redirectUrl: string | null;
  /** Estado inicial del KYC tras crear la sesión. */
  initialStatus: 'pending' | 'in_review';
}

/**
 * Frontera con el proveedor de la parte ADVERSARIAL del KYC (liveness +
 * autenticidad del documento). El resto (orquestación, OCR/MRZ, AML) es nuestro.
 * Cambiar de proveedor = nuevo adaptador, sin tocar KycService.
 */
export interface KycProvider {
  readonly name: string;
  /** Inicia la verificación de liveness/documento para un usuario. */
  createSession(input: { userId: string; fullName: string | null }): Promise<ProviderSession>;
}
