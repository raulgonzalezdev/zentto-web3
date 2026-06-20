import { KycProvider, ProviderSession } from './kyc-provider';

/**
 * Proveedor por defecto: SIN dependencia externa. La verificación queda en
 * `in_review` para que un operador del backoffice la apruebe/rechace a mano.
 * Útil en dev y como respaldo si el proveedor externo no está configurado.
 */
export class ManualReviewProvider implements KycProvider {
  readonly name = 'manual';

  createSession(): Promise<ProviderSession> {
    return Promise.resolve({ ref: null, redirectUrl: null, initialStatus: 'in_review' });
  }
}
