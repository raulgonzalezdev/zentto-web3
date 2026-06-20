import { Injectable } from '@nestjs/common';

export interface MrzFields {
  documentNumber: string;
  nationality: string;
  birthDate: string; // YYMMDD
  sex: string;
  expiryDate: string; // YYMMDD
}

export interface MrzResult {
  valid: boolean;
  fields?: MrzFields;
  errors: string[];
}

/**
 * Parser y validador de MRZ TD3 (pasaportes, 2 líneas × 44) — implementación PROPIA.
 *
 * No "confía" en el OCR: recalcula los dígitos de control (ISO 7501 / ICAO 9303,
 * pesos 7-3-1) sobre número de documento, fecha de nacimiento, fecha de expiración
 * y el dígito compuesto final. Si un dígito no cuadra, el dato fue mal leído o
 * manipulado → la verificación no avanza. Esto es lo que SÍ tiene sentido construir
 * en casa (algoritmo cerrado, determinista, sin adversario sofisticado).
 */
@Injectable()
export class MrzService {
  private charValue(c: string): number {
    if (c === '<') return 0;
    if (c >= '0' && c <= '9') return c.charCodeAt(0) - 48;
    if (c >= 'A' && c <= 'Z') return c.charCodeAt(0) - 55; // A=10 … Z=35
    return -1;
  }

  /** Dígito de control ICAO 9303 (pesos 7,3,1 cíclicos). */
  checkDigit(input: string): number {
    const weights = [7, 3, 1];
    let sum = 0;
    for (let i = 0; i < input.length; i++) {
      const v = this.charValue(input[i]);
      if (v < 0) return -1;
      sum += v * weights[i % 3];
    }
    return sum % 10;
  }

  /** Valida una MRZ TD3 (44+44). Acepta con o sin salto de línea. */
  parseTd3(raw: string): MrzResult {
    const errors: string[] = [];
    const cleaned = raw.toUpperCase().replace(/\r?\n/g, '').replace(/\s/g, '');
    if (cleaned.length !== 88) {
      return {
        valid: false,
        errors: [`MRZ TD3 debe tener 88 caracteres (recibidos ${cleaned.length})`],
      };
    }
    const l2 = cleaned.slice(44);

    const documentNumber = l2.slice(0, 9);
    const docCd = l2[9];
    const nationality = l2.slice(10, 13);
    const birthDate = l2.slice(13, 19);
    const birthCd = l2[19];
    const sex = l2[20];
    const expiryDate = l2.slice(21, 27);
    const expiryCd = l2[27];
    const personalNumber = l2.slice(28, 42);
    const personalCd = l2[42];
    const finalCd = l2[43];

    const expect = (label: string, field: string, cd: string) => {
      const calc = this.checkDigit(field);
      if (calc < 0 || calc !== Number(cd)) {
        errors.push(`Dígito de control inválido en ${label}`);
      }
    };
    expect('número de documento', documentNumber, docCd);
    expect('fecha de nacimiento', birthDate, birthCd);
    expect('fecha de expiración', expiryDate, expiryCd);

    // Dígito compuesto final: sobre documento+cd+nacimiento+cd+expiración+cd+personal+cd.
    const composite =
      documentNumber +
      docCd +
      birthDate +
      birthCd +
      expiryDate +
      expiryCd +
      personalNumber +
      personalCd;
    const compCalc = this.checkDigit(composite);
    if (compCalc < 0 || compCalc !== Number(finalCd)) {
      errors.push('Dígito de control compuesto inválido');
    }

    return {
      valid: errors.length === 0,
      fields: {
        documentNumber: documentNumber.replace(/</g, ''),
        nationality,
        birthDate,
        sex,
        expiryDate,
      },
      errors,
    };
  }
}
